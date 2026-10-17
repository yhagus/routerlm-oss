import type { Runtime } from "../../runtime";
import type { ApiKeyRecord, ProviderConnection } from "../../db/repositories";
import { translateRequest, translateResponse, initState, needsTranslation } from "./translator/index.js";
import { parseUpstreamError } from "../common/error.ts";
import { gatewayErrorResponse, type GatewayErrorSource } from "./gatewayError.ts";
import { attemptFailed, connectionsBusyResponse, fallbackAttempts, nextConnectionAttempt } from "./connectionAttempt";
import { handleComboChat, handleFusionChat, augmentWithVisionAdapter, detectRequiredCapabilities } from "./combo.js";
import { credentialToken, refreshAfterAuthFailure, refreshConnectionCredentials } from "../providers/refreshCoordinator.ts";
import { resolveTransport } from "../providers/provider.ts";
import { getModelStrip, getModelType, PROVIDER_ID_TO_ALIAS } from "../providers/config/providerModels.ts";
import { stripThinkingSuffix } from "./translator/concerns/thinkingUnified.js";
import { normalizeClaudePassthrough } from "./translator/formats/claude.js";
import { getCapabilitiesForModel } from "../providers/capabilities.ts";
import { applyCapabilityOverride, capabilityOverrideFor } from "../providers/modelCapabilityOverrides.ts";
import { stripUnsupportedModalities } from "./translator/concerns/modality.js";
import { prefetchRemoteImages } from "./translator/concerns/prefetch.js";
import { dedupeTools } from "./utils/toolDeduper.js";
import { buildGrokCliCompactionResponse } from "./grokCliCompaction.js";
import { getProjectIdForConnection } from "../providers/discovery/projectId.ts";
import { extractUsage } from "../common/usageTracking.ts";
import * as logger from "./sse/utils/logger.js";
import { formatDoneLine } from "./handlers/requestDetail.js";
import { extractThinking } from "./translator/concerns/thinkingUnified.js";
import { getProviderRegistryEntry, resolveProviderTransport } from "../providers/providerCatalog";
import { enforceApiKeyAccess, mediaModelInfo } from "../media/shared";
import { getV2Executor } from "./executors";
import { selectChatConnection, markAccountUnavailable, clearAccountError, codexFallbackModelsFor, connectionProxyOptions } from "./credentials";
import type { ConnectionSlot } from "./inFlightSlots";
import { checkFallbackError } from "./accountFallback.js";
import { pinnedConnectionIds } from "./gateway";
import { clientFormatToV1, detectSourceFormat, resolveExecutionTarget, type ClientFormat } from "./formats";
import { createCompletionAccumulator, fromAnthropic, fromGeminiShape, fromResponsesShape, mergeChunksToCompletion, toClaude, toOpenAi, toResponses } from "./converters";
import { applyProviderThinking, applyTokenSavers, comboIdentityBody, detectTool, nativePassthrough, tryBypassRequest, type MutatorHeaders } from "./mutators";
import { applyCodebuddyReasoningSummary } from "./codebuddyThinking";
import { resolveExitIp } from "../common/exitIp.ts";
import { buildRequestDetail, computeTokensPerSecond, extractRequestConfig, saveRequestDetail } from "./requestDetails";

const log = logger;

export interface ChatDispatchInput {
  body: Record<string, unknown>;
  source: ClientFormat;
  endpoint: string;
  pathname: string | null;
  apiKey: ApiKeyRecord | null;
  clientIp?: string;
  headers?: MutatorHeaders | null;
  userAgent?: string;
  signal?: AbortSignal;
}

interface ComboChatContext {
  comboIdentityName: string | null;
  comboName: string | null;
}

// One provider/model of a chat request: the account Fallback loop input.
interface ModelAttempt {
  input: ChatDispatchInput;
  provider: string;
  model: string;
  // Combo account filter (null = every Connection).
  allowedIds: string[] | null;
  combo: ComboChatContext;
  // Combo custom account order (null = provider strategy order).
  accountOrder: string[] | null;
}

function errorSource(source: ChatDispatchInput["source"]): GatewayErrorSource {
  return source === "claude" ? "claude" : source === "responses" ? "responses" : source === "ollama" ? "ollama" : "openai";
}

// Client-facing gateway error: mapped status plus a generic per-surface body.
// Raw upstream text never reaches the client; it stays attached as
// `response.upstreamError` for fallback classification and logs.
function errorBody(source: GatewayErrorSource, status: number, rawMessage: string): Response {
  return gatewayErrorResponse(status, source, rawMessage);
}

function upstreamErrorOf(response: Response): { status: number; message: string } | null {
  const attached = (response as Response & { upstreamError?: { status: number; message: string } }).upstreamError;
  return attached || null;
}

function recordUsage(runtime: Runtime, input: { provider: string; model?: string | null; connectionId?: string | null; apiKey?: ApiKeyRecord | null; endpoint: string; clientIp?: string; comboName?: string | null; promptTokens?: number; completionTokens?: number; usage?: Record<string, unknown> | null; ttftMs?: number; totalMs?: number }): void {
  const prompt = Number(input.usage?.prompt_tokens ?? input.usage?.input_tokens ?? input.promptTokens ?? 0) || 0;
  const completion = Number(input.usage?.completion_tokens ?? input.usage?.output_tokens ?? input.completionTokens ?? 0) || 0;
  const meta: Record<string, unknown> = input.comboName ? { comboName: input.comboName } : {};
  const totalMs = Number(input.totalMs);
  if (Number.isFinite(totalMs) && totalMs > 0) {
    meta.totalMs = Math.round(totalMs);
    const ttftMs = Number(input.ttftMs ?? 0);
    const generationMs = Math.max(0, totalMs - (Number.isFinite(ttftMs) ? ttftMs : 0));
    if (completion > 0 && generationMs > 0) {
      meta.tokensPerSecond = Math.round((completion / (generationMs / 1000)) * 100) / 100;
    }
  }
  runtime.repos.usage.record({
    provider: input.provider,
    model: input.model || null,
    connectionId: input.connectionId || null,
    apiKey: input.apiKey?.key || null,
    endpoint: input.endpoint,
    clientIp: input.clientIp || null,
    promptTokens: prompt,
    completionTokens: completion,
    tokens: input.usage || {},
    ...(Object.keys(meta).length ? { meta } : {}),
  });
  if (input.apiKey) runtime.repos.keys.incrementUsage(input.apiKey.id, Number(input.usage?.total_tokens || prompt + completion));
}

// Emit one client-format SSE frame. Claude wire format pairs an event line
// with the data line; OpenAI formats are data-only.
function sseFrame(encoder: TextEncoder, sourceFormat: string, chunk: Record<string, unknown>): Uint8Array {
  const payload = JSON.stringify(chunk);
  if ((sourceFormat === "claude" || sourceFormat === "openai-responses") && typeof chunk.type === "string") return encoder.encode(`event: ${chunk.type}\ndata: ${payload}\n\n`);
  return encoder.encode(`data: ${payload}\n\n`);
}

interface SseParser {
  onChunk: (chunk: Record<string, unknown>) => void;
}

function sseData(message: string): string | null {
  const data = message
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  return data || null;
}

// Parse `data:` payloads out of a byte stream, translating each provider chunk
// into the client format. Calls back per translated chunk.
async function transformSse(
  body: ReadableStream<Uint8Array>,
  providerResponseFormat: string,
  sourceFormat: string,
  onChunk: SseParser["onChunk"],
): Promise<void> {
  const state = initState(sourceFormat);
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  const handleRaw = (raw: string) => {
    if (!raw || raw === "[DONE]") return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw); } catch { return; }
    const translated = needsTranslation(providerResponseFormat, sourceFormat)
      ? (translateResponse(providerResponseFormat, sourceFormat, parsed, state) as Record<string, unknown>[])
      : [parsed];
    for (const chunk of translated || []) onChunk(chunk);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split(/\r?\n\r?\n/);
    buffer = messages.pop() || "";
    for (const message of messages) {
      const raw = sseData(message);
      if (raw) handleRaw(raw);
    }
  }
  buffer += decoder.decode();
  const raw = sseData(buffer);
  if (raw) handleRaw(raw);
}

// Delegate to v1's extractUsage so every format is covered: OpenAI
// (chunk.usage), Claude (message_start/message_delta), Responses
// (response.completed/response.done → chunk.response.usage), Gemini
// (usageMetadata), and Ollama (prompt_eval_count). v2's previous
// implementation only checked chunk.usage, missing Responses and Claude.
function sniffUsage(chunks: Record<string, unknown>[]): Record<string, unknown> | null {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const extracted = extractUsage(chunks[index]) as Record<string, unknown> | null;
    if (extracted) return extracted;
  }
  return null;
}

// v1's usageTracking estimate: request JSON averages four characters/token,
// emitted text averages four characters/token, and a 2k context buffer is
// added to prompt/total tokens. This is deliberately a fallback only — real
// provider usage always wins.
function buildEstimatedUsage(body: Record<string, unknown>, outputLength: number, sourceFormat: string): Record<string, unknown> | null {
  if (outputLength <= 0) return null;
  let inputLength = 0;
  try { inputLength = JSON.stringify(body).length; } catch { return null; }
  const inputTokens = Math.ceil(inputLength / 4);
  const outputTokens = Math.max(1, Math.floor(outputLength / 4));
  if (sourceFormat === "claude" || sourceFormat === "openai-responses") return { input_tokens: inputTokens + 2000, output_tokens: outputTokens, estimated: true };
  return { prompt_tokens: inputTokens + 2000, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens + 2000, estimated: true };
}

// Characters of emitted text in one translated stream chunk.
function chunkOutputLength(chunk: Record<string, unknown>): number {
  let outputLength = 0;
  // OpenAI chat-completions: choices[0].delta.content
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] as Record<string, unknown> | undefined : undefined;
  const delta = choice?.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};
  if (typeof delta.content === "string") outputLength += delta.content.length;
  if (typeof delta.reasoning_content === "string") outputLength += delta.reasoning_content.length;
  // Claude: chunk.delta.text / chunk.delta.thinking (content_block_delta)
  if (typeof (chunk.delta as Record<string, unknown> | undefined)?.text === "string") outputLength += String((chunk.delta as Record<string, unknown>).text).length;
  if (typeof (chunk.delta as Record<string, unknown> | undefined)?.thinking === "string") outputLength += String((chunk.delta as Record<string, unknown>).thinking).length;
  // Responses: chunk.delta is a string (response.output_text.delta)
  if (typeof chunk.delta === "string") outputLength += chunk.delta.length;
  // Responses: chunk.text (response.output_text.done carries the full text)
  if (typeof chunk.text === "string") outputLength += chunk.text.length;
  return outputLength;
}

function estimateStreamUsage(body: Record<string, unknown>, chunks: Record<string, unknown>[], sourceFormat: string): Record<string, unknown> | null {
  let outputLength = 0;
  for (const chunk of chunks) outputLength += chunkOutputLength(chunk);
  return buildEstimatedUsage(body, outputLength, sourceFormat);
}

// Running stream summary: the Usage sniff, the emitted text length for the
// Usage estimate, and a capped completion for the request detail. It replaces
// a list of every translated chunk, so a long stream holds bounded memory.
const STREAM_SUMMARY_MAX_TEXT = 64 * 1024;
const STREAM_SUMMARY_MAX_TOOL_CALLS = 64;

function createStreamSummary(body: Record<string, unknown>, sourceFormat: string) {
  const completion = createCompletionAccumulator({ maxTextLength: STREAM_SUMMARY_MAX_TEXT, maxToolCalls: STREAM_SUMMARY_MAX_TOOL_CALLS });
  let usage: Record<string, unknown> | null = null;
  let outputLength = 0;
  const sniff = (chunk: Record<string, unknown>) => {
    const extracted = extractUsage(chunk) as Record<string, unknown> | null;
    if (extracted) usage = extracted;
  };
  return {
    // Record one chunk before it is sent. A finish chunk without any Usage so
    // far gets an estimated `usage` field, as the client sees it.
    add(chunk: Record<string, unknown>) {
      outputLength += chunkOutputLength(chunk);
      sniff(chunk);
      if (isStreamFinish(chunk) && !usage) {
        const estimated = buildEstimatedUsage(body, outputLength, sourceFormat);
        if (estimated) {
          chunk.usage = estimated;
          sniff(chunk);
        }
      }
      completion.add(chunk);
    },
    // Provider Usage, else an estimate from the emitted text.
    usage(): Record<string, unknown> | null {
      return usage || buildEstimatedUsage(body, outputLength, sourceFormat);
    },
    completion: () => completion.result(),
  };
}

// Estimate usage from a non-streaming JSON response (fallback when the
// provider omits usage from the response body).
function estimateJsonUsage(body: Record<string, unknown>, response: Record<string, unknown>, sourceFormat: string): Record<string, unknown> | null {
  return buildEstimatedUsage(body, textOf(response).length, sourceFormat);
}

function isStreamFinish(chunk: Record<string, unknown>): boolean {
  if (chunk.type === "message_delta") return true;
  // Responses terminal events
  if (chunk.type === "response.completed" || chunk.type === "response.done" || chunk.type === "response.failed" || chunk.type === "response.incomplete") return true;
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] as Record<string, unknown> | undefined : undefined;
  return Boolean(choice?.finish_reason);
}

// v1 chatCore stream decision: providers may force SSE, clients may prefer
// JSON via Accept, deepseek-tui needs JSON in non-interactive mode, and image
// generation models must not stream.
function resolveStreamSemantics(input: ChatDispatchInput, provider: string, alias: string, model: string, body: Record<string, unknown>) {
  const clientRequestedStreaming = body.stream === true;
  const providerRequiresStreaming = Boolean((getProviderRegistryEntry(provider) as Record<string, any> | null)?.transport?.forceStream);
  let stream = providerRequiresStreaming ? true : body.stream === true;

  const modelType = getModelType(alias, model);
  if ((modelType === "imageGen" || /image|imagen|image-generation/i.test(model)) && provider === "antigravity") {
    stream = false;
  }

  const clientTool = detectTool(input.headers || null, body);
  if (clientTool === "deepseek-tui" && body.stream !== true) stream = false;

  const accept = String(input.headers?.accept ?? "");
  const clientPrefersJson = accept.includes("application/json");
  const clientPrefersSse = accept.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSse && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  // Provider forced SSE but the client never asked to stream → buffer to JSON.
  const forcedSseToJson = !clientRequestedStreaming && providerRequiresStreaming;
  const clientGetsStream = stream && !forcedSseToJson;
  return { stream, clientRequestedStreaming, clientGetsStream, clientTool };
}

// Execute one provider/model through its specialized executor with the v1
// account-fallback semantics. Returns null when the provider has no
// specialized executor (caller falls back to the generic gateway path).
//
// Codex per-model fallback chains (settings.codex.modelFallbacks) apply here:
// when the requested model fails on every account eligible to serve it with a
// fallback-classified error (429/402/5xx), the request is retried with the
// next model in the chain. Plan allowlists still gate each model tried.
async function runExecutorModel(runtime: Runtime, attempt: ModelAttempt): Promise<Response | null> {
  const { provider, model } = attempt;
  const executor = getV2Executor(provider);
  if (!executor) return null;

  if (provider !== "codex") return runExecutorModelAttempt(runtime, attempt);

  // Build the model chain: requested model first, then its configured
  // fallbacks in priority order. A visited-set breaks cycles; a depth cap
  // guards against pathological configurations.
  const MAX_CHAIN_DEPTH = 3;
  const chain: string[] = [model];
  const visited = new Set<string>([model]);
  let cursor = model;
  while (chain.length <= MAX_CHAIN_DEPTH) {
    const next = codexFallbackModelsFor(runtime, cursor).find((candidate) => !visited.has(candidate));
    if (!next) break;
    visited.add(next);
    chain.push(next);
    cursor = next;
  }

  let lastResponse: Response | null = null;
  for (let index = 0; index < chain.length; index += 1) {
    const chainModel = chain[index];
    const response = await runExecutorModelAttempt(runtime, { ...attempt, model: chainModel });
    if (!response) return null;
    if (response.ok) return response;
    if (index === chain.length - 1) return response;
    // Advance only when the failure is fallback-classified; client errors
    // (4xx other than quota/auth) are returned to the client unchanged.
    const upstream = upstreamErrorOf(response);
    if (!upstream) return response;
    const { shouldFallback } = checkFallbackError(upstream.status, upstream.message);
    if (!shouldFallback) return response;
    log.info("CODEX", `model ${chainModel} unavailable (${upstream.status}), trying fallback ${chain[index + 1]}`, null);
    lastResponse = response;
  }
  return lastResponse;
}

// One model of the chain: the v1 account-fallback loop for a single
// provider/model. Mirrors the pre-chain runExecutorModel behavior. An
// unexpected throw releases every Connection slot the attempt still holds;
// a returned stream keeps its slot until the stream ends or is cancelled.
async function runExecutorModelAttempt(runtime: Runtime, attempt: ModelAttempt): Promise<Response | null> {
  const heldSlots = new Set<ConnectionSlot>();
  try {
    return await runExecutorModelAttemptWithSlots(runtime, attempt, heldSlots);
  } catch (error) {
    for (const slot of heldSlots) slot.release();
    throw error;
  }
}

async function runExecutorModelAttemptWithSlots(runtime: Runtime, attempt: ModelAttempt, heldSlots: Set<ConnectionSlot>): Promise<Response | null> {
  const { input, provider, model, allowedIds, combo, accountOrder } = attempt;
  const executor = getV2Executor(provider);
  if (!executor) return null;
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const alias = (PROVIDER_ID_TO_ALIAS as Record<string, string>)[provider] || provider;
  const providerThinking = (settings.providerThinking || {})[provider] || null;
  const requestStartTime = Date.now();

  const clientSource = clientFormatToV1(input.source);
  // Ollama-shaped bodies pivot through OpenAI before the v1 translators.
  const clientBody = input.source === "ollama" ? toOpenAi(input.body, "ollama") : input.body;
  const sourceFormat = input.pathname ? detectSourceFormat(input.pathname, clientBody) : clientSource;
  const { targetFormat, upstreamModel } = resolveExecutionTarget(provider, model, sourceFormat);
  const stripList = getModelStrip(alias, model);
  const { stream: upstreamStream, clientRequestedStreaming, clientGetsStream, clientTool } = resolveStreamSemantics(input, provider, alias, model, input.body);
  const passthrough = nativePassthrough(clientTool, provider);
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  const preferredId = typeof input.headers?.["x-connection-id"] === "string"
    ? input.headers["x-connection-id"]
    : typeof input.headers?.["x-lobakai-connection-id"] === "string"
      ? input.headers["x-lobakai-connection-id"]
      : null;
  let toolNameMap: Map<string, string> | null = null;
  const attempts = fallbackAttempts(settings);
  const select = (excludeIds: Set<string>) => selectChatConnection(runtime, provider, { model, excludeIds, allowedIds, accountOrder, preferredId });

  while (true) {
    // The step takes the Connection slot before the first await after
    // selection. The slot also feeds the dashboard "active traffic" card
    // (v1 trackPendingRequest). endPending fires at stream completion or
    // client cancel for streaming responses, or immediately for
    // non-streaming and error paths.
    const step = nextConnectionAttempt(runtime, attempts, select, { provider, model, apiKey: input.apiKey?.key || null });
    if (step.kind === "saturated") return connectionsBusyResponse(errorSource(input.source));
    if (step.kind !== "attempt") {
      // Never name the provider or the account pool: the client sees only a
      // generic unavailability error.
      const lastError = attempts.lastError;
      if (!lastError) return errorBody(errorSource(input.source), 503, `No credentials for provider: ${provider}`);
      return errorBody(errorSource(input.source), lastError.status, lastError.message);
    }
    const { connection, credentials, synthetic } = step.selected;
    const connectionId = synthetic ? null : connection.id;
    const slot = step.slot;
    if (slot) heldSlots.add(slot);
    const endPending = () => {
      if (!slot) return;
      slot.release();
      heldSlots.delete(slot);
    };

    // v1 chatCore: executors may read the negotiated transport and raw headers.
    // Resolve against the target format first so single-endpoint providers
    // (e.g. bitdeer, which only speaks chat completions) still get their
    // transport when the client sent a different source format (claude/responses).
    const runtimeTransport =
      resolveProviderTransport(provider, targetFormat) ||
      resolveProviderTransport(provider, sourceFormat) ||
      resolveTransport(provider, targetFormat) ||
      resolveTransport(provider, sourceFormat);
    const configuredBaseUrl = typeof credentials.baseUrl === "string" && credentials.baseUrl.trim()
      ? credentials.baseUrl.trim().replace(/\/$/, "")
      : null;
    if (configuredBaseUrl) {
      // A connection-level endpoint overrides the registry transport just as
      // v1's generic gateway did. DefaultExecutor consumes runtimeTransport
      // for every provider family, whereas its providerSpecificData override
      // applies only to explicitly compatible-node ids.
      const terminalPath = targetFormat === "claude" ? "/messages" : targetFormat === "openai-responses" ? "/responses" : "/chat/completions";
      const isTerminal = configuredBaseUrl.endsWith(terminalPath);
      credentials.runtimeTransport = { baseUrl: configuredBaseUrl, urlSuffix: isTerminal ? "" : configuredBaseUrl.endsWith("/v1") ? terminalPath : `/v1${terminalPath}` };
    } else if (runtimeTransport) credentials.runtimeTransport = runtimeTransport;
    credentials.rawHeaders = input.headers || {};
    const proxyOptions = connectionProxyOptions(credentials);
    // Probe the upstream-facing exit IP in parallel with translation. Cached
    // per proxy route (60s TTL), so this only costs a round-trip on expiry.
    const exitIpPromise = resolveExitIp(proxyOptions);

    // Root refreshes expiring credentials before dispatch, not only after a
    // failed request. This avoids spending an upstream attempt on stale tokens.
    // Concurrent requests on one Connection share one refresh.
    if (!synthetic && !executor.noAuth && executor.needsRefresh?.(credentials) && executor.refreshCredentials) {
      try {
        const outcome = await refreshConnectionCredentials(runtime, connection.id, { log });
        if (outcome) Object.assign(credentials, outcome.credentials);
      } catch { /* the normal 401/403 refresh path retains root fallback behavior */ }
    }

    // Google-backed executors need a concrete Code Assist project before the
    // first request. Root hydrates and persists it lazily per connection.
    if (!synthetic && provider === "antigravity" && !credentials.projectId && credentials.accessToken) {
      try {
        const projectId = await getProjectIdForConnection(connection.id, credentials.accessToken, provider);
        if (projectId) {
          credentials.projectId = projectId;
          runtime.repos.providers.patch(connection.id, { data: { projectId } });
        }
      } catch { /* executors retain their provider-specific fallback project behavior */ }
    }

    // Pre-translation source-body mutators (v1 applies per chatCore attempt).
    let sourceBody = comboIdentityBody(clientBody, sourceFormat, combo.comboIdentityName);
    sourceBody = applyProviderThinking(sourceBody, providerThinking);

    // Auto-strip media blocks the model can't read (vision/audio/pdf), then
    // convert remote image URLs to base64 for targets that can't fetch URLs.
    if (!passthrough) {
      const caps = effectiveModelCapabilities(runtime, alias, model);
      stripUnsupportedModalities(sourceBody, sourceFormat, caps);
      try { await prefetchRemoteImages(sourceBody, sourceFormat, targetFormat, { signal: input.signal }); } catch { /* fail open */ }
    }

    let result: Awaited<ReturnType<typeof executor.execute>>;
    let translatedBody: Record<string, unknown> | null = null;
    let pxpipeSummary: Record<string, unknown> | null = null;
    // Snapshot the client request config before translation mutates sourceBody
    // (which is the same reference as input.body for non-combo requests).
    // extractRequestConfig deep-copies the body, so this snapshot is immune
    // to any later in-place mutations by translators, mutators, or the stream.
    const requestSnapshot = extractRequestConfig(input.body, input.body.stream === true);
    const detailBase = (): Record<string, any> => ({
      provider,
      model,
      connectionId: connectionId || undefined,
      request: requestSnapshot,
      requestHeaders: input.headers || {},
      clientIp: input.clientIp,
      comboName: combo.comboName || undefined,
      pxpipe: pxpipeSummary || undefined,
    });
    // v1 chatCore: colored request tag for correlated log lines.
    const reqTag = log.tagForSession ? log.tagForSession(connectionId || "") : (log.nextTag ? log.nextTag() : "");
    try {
      if (passthrough) {
        translatedBody = { ...sourceBody, model: stripThinkingSuffix(upstreamModel) };
        if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model as string);
      } else {
        translatedBody = needsTranslation(sourceFormat, targetFormat)
          ? translateRequest(sourceFormat, targetFormat, upstreamModel, sourceBody, upstreamStream, credentials, provider, log, stripList, connectionId, clientTool) as Record<string, unknown>
          : { ...sourceBody, model: upstreamModel };
      }

      // The translator attaches this Map only to carry client tool names back
      // through response translation. It is not provider request data (JSON
      // serializes a Map as `{}` and strict upstream schemas reject it).
      if (translatedBody._toolNameMap instanceof Map) toolNameMap = translatedBody._toolNameMap as Map<string, string>;
      delete translatedBody._toolNameMap;

      // Dedupe duplicate built-in tools when equivalent MCP tools are present
      // (Claude clients only).
      if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
        const deduped = dedupeTools(translatedBody.tools as unknown[]) as { tools: unknown[]; stripped: string[] };
        if (deduped?.stripped?.length > 0) translatedBody.tools = deduped.tools;
      }

      // grok-cli consumes the client's prompt_cache_key as a routing/session
      // signal even though the Responses translator strips it.
      if (provider === "grok-cli" && sourceBody.prompt_cache_key && !translatedBody.prompt_cache_key) {
        translatedBody.prompt_cache_key = sourceBody.prompt_cache_key;
      }
      if (provider === "grok-cli" && sourceBody._compact === true) translatedBody._compact = true;

      // TTS models don't support tool messages/function calling.
      if (getModelType(alias, model) === "tts" && translatedBody.messages) {
        translatedBody.messages = (translatedBody.messages as Record<string, unknown>[]).filter((msg) => msg.role !== "tool");
        delete translatedBody.tools;
      }

      // CLI parity: CodeBuddy defaults thinking on and always sends
      // `reasoning_summary: "auto"` on the wire, which is what makes the
      // upstream gateway emit `delta.reasoning_content` thinking chunks.
      translatedBody = applyCodebuddyReasoningSummary(translatedBody, provider, providerThinking);

      const saved = await applyTokenSavers(runtime, input.headers || null, translatedBody, { provider, model: upstreamModel, format: finalFormat });
      translatedBody = saved.body;
      pxpipeSummary = saved.pxpipeSummary;

      // v1 chatCore request line: one correlated summary per attempt.
      if (log.line) {
        const clientModel = input.body.model || `${provider}/${model}`;
        const msgN = (translatedBody.messages as unknown[])?.length || (translatedBody.input as unknown[])?.length || (translatedBody.contents as unknown[])?.length || (input.body.messages as unknown[])?.length || (input.body.input as unknown[])?.length || 0;
        const toolN = (translatedBody.tools as unknown[])?.length || (input.body.tools as unknown[])?.length || 0;
        const fmtStr = passthrough ? `FMT: ${sourceFormat} (passthrough)` : `FMT: ${sourceFormat}→${targetFormat}`;
        const acc = (credentials as Record<string, unknown>)?.connectionName || connectionId?.slice(0, 8) || "-";
        const parts = [
          `POST ${clientModel} → ${provider}/${model}`,
          fmtStr,
          upstreamStream ? "STREAM" : "JSON",
          `${msgN} MSG`,
        ];
        if (toolN) parts.push(`${toolN} TOOL`);
        parts.push(`ACC:${acc}`);
        const exitIp = await exitIpPromise;
        if (exitIp) parts.push(`IP:${exitIp}`);
        log.line(reqTag, "▶", parts.join(" · "));
      }

      result = await executor.execute({ model: upstreamModel, body: translatedBody, stream: upstreamStream, credentials, signal: input.signal, log, proxyOptions });
    } catch (error: any) {
      const message = error instanceof Error ? error.message : "Upstream request failed";
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) { endPending(); return errorBody(errorSource(input.source), 499, "Client closed request"); }
      if (log.errorLine) log.errorLine(reqTag, "✗", `ERROR 502 · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${message}${error instanceof Error && error.stack ? `\n    ${error.stack}` : ""}`);
      saveRequestDetail(runtime, buildRequestDetail({
        ...detailBase(),
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        providerRequest: translatedBody || null,
        response: { error: message, status: 502, thinking: null },
        status: "error",
      }));
      endPending();
      if (!synthetic && await markAccountUnavailable(runtime, connection, 502, message, provider, model)) {
        attemptFailed(attempts, connection.id, 502, message);
        continue;
      }
      return errorBody(errorSource(input.source), 502, message);
    }

    let response = result.response;

    // 401/403 → one refresh through the coordinator → single retry. When
    // another request already refreshed this Connection, the retry uses the
    // stored Credentials and the Provider sees no second refresh.
    if ((response.status === 401 || response.status === 403) && !executor.noAuth && executor.refreshCredentials) {
      try {
        let refreshed = false;
        if (synthetic) {
          const refreshResult = await executor.refreshCredentials(credentials, log, proxyOptions);
          if (refreshResult?.accessToken || refreshResult?.apiKey) {
            Object.assign(credentials, refreshResult);
            refreshed = true;
          }
        } else {
          const stored = await refreshAfterAuthFailure(runtime, connection.id, credentialToken(credentials), { log });
          if (stored) {
            Object.assign(credentials, stored);
            refreshed = true;
          }
        }
        if (refreshed) {
          try {
            const retry = await executor.execute({ model: upstreamModel, body: translatedBody, stream: upstreamStream, credentials, signal: input.signal, log, proxyOptions });
            // The retry replaces the rejected response: release its body.
            await response.body?.cancel().catch(() => {});
            result = retry;
            response = retry.response;
          } catch { /* report the original 401/403 below */ }
        }
      } catch { /* account needs re-auth; fall through to error handling */ }
    }

    if (!response.ok) {
      let statusCode = response.status;
      let message = `HTTP ${response.status}`;
      let resetsAtMs: number | null = null;
      let disableAccount = false;
      let upstreamCode: string | null = null;
      try {
        const parsed = await parseUpstreamError(response, executor) as { statusCode: number; message: string; resetsAtMs?: number; disableAccount?: boolean; code?: string | null };
        statusCode = parsed.statusCode || statusCode;
        message = parsed.message || message;
        resetsAtMs = parsed.resetsAtMs ?? null;
        disableAccount = parsed.disableAccount === true;
        upstreamCode = parsed.code ?? null;
      } catch { /* keep the status-line fallback */ }
      if (log.errorLine) log.errorLine(reqTag, "✗", `ERROR ${statusCode} · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${message}`);
      saveRequestDetail(runtime, buildRequestDetail({
        ...detailBase(),
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        providerRequest: translatedBody || null,
        response: { error: message, status: statusCode, thinking: null },
        responseHeaders: headersToObject(response.headers),
        status: "error",
      }));
      endPending();
      if (!synthetic && await markAccountUnavailable(runtime, connection, statusCode, message, provider, model, resetsAtMs, disableAccount, upstreamCode)) {
        attemptFailed(attempts, connection.id, statusCode, message);
        continue;
      }
      return errorBody(errorSource(input.source), statusCode, message);
    }

    if (!synthetic) clearAccountError(runtime, connection, model);

    const providerResponseFormat = (result.responseFormat as string | undefined) || targetFormat;
    const contentType = response.headers.get("content-type") || "";
    // Responses providers sometimes omit Content-Type while still returning a
    // valid SSE body. Root chatCore treats that transport as SSE so forced
    // non-streaming requests can be buffered into an OpenAI completion.
    const isSse = contentType.includes("text/event-stream")
      || (contentType === "" && providerResponseFormat === "openai-responses");
    const usageCtx = { provider, model, connectionId, apiKey: input.apiKey, endpoint: input.endpoint, clientIp: input.clientIp, comboName: combo.comboName || null };

    // grok-cli compaction probes answer with a synthetic compacted history.
    if (provider === "grok-cli" && (sourceBody as Record<string, unknown>)._compact && !upstreamStream) {
      endPending();
      try {
        const compactResponse = await response.json() as Record<string, unknown>;
        const compacted = buildGrokCliCompactionResponse(compactResponse, (sourceBody.prompt_cache_key as string) || connectionId || "", false);
        return new Response(JSON.stringify(compacted), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      } catch { /* fall through to the normal response path */ }
    }

    const captureDetail = (usage: Record<string, unknown> | null, responseBody: Record<string, unknown>, ttftMs: number = 0) => {
      const totalMs = Date.now() - requestStartTime;
      const outTokens = Number((usage || {}).completion_tokens ?? (usage || {}).output_tokens ?? 0) || 0;
      const tokensPerSecond = computeTokensPerSecond(outTokens, totalMs, ttftMs);
      saveRequestDetail(runtime, buildRequestDetail({
        ...detailBase(),
        latency: { ttft: ttftMs, total: totalMs, tokensPerSecond },
        tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
        providerRequest: translatedBody,
        response: responseBody,
        responseHeaders: headersToObject(response.headers),
        status: "success",
      }));
    };

    if (clientGetsStream) {
      if (isSse && response.body) {
        const encoder = new TextEncoder();
        const passthroughFormat = providerResponseFormat === sourceFormat && sourceFormat !== "claude";
        const state = passthroughFormat ? null : initState(sourceFormat);
        if (state && toolNameMap) (state as any).toolNameMap = toolNameMap;
        const providerStallTimeoutMs = Number((getProviderRegistryEntry(provider) as Record<string, unknown> | null)?.stallTimeoutMs);
        const stallTimeoutMs = Number.isFinite(providerStallTimeoutMs) && providerStallTimeoutMs > 0
          ? providerStallTimeoutMs
          : runtime.config.streamStallTimeoutMs || 360_000;
        // Pull-based: the stream reads one upstream chunk each time the client
        // wants more data, so a slow client applies backpressure to the
        // Provider body instead of buffering it here. The upstream reader stays
        // reachable from cancel(): a client disconnect must stop the provider
        // body, or a long generation stays live after the client is gone.
        const upstreamReader = response.body.getReader();
        const decoder = new TextDecoder();
        const summary = createStreamSummary(sourceBody, sourceFormat);
        let buffer = "";
        let responsesTerminalSeen = false;
        let doneSent = false;
        let firstByteTime = 0;
        let finished = false;
        let finishStarted = false;
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const clearStallTimer = () => {
          if (stallTimer) clearTimeout(stallTimer);
          stallTimer = null;
        };
        // Match v1: watchdog activity is measured from raw provider bytes,
        // never translated frames. The timer runs only while a read waits on
        // the provider, so a slow client never trips it.
        const armStallTimer = () => {
          clearStallTimer();
          stallTimer = setTimeout(() => {
            stallTimer = null;
            void upstreamReader.cancel("stream stall timeout").catch(() => {});
          }, stallTimeoutMs);
        };
        const handleRaw = (controller: ReadableStreamDefaultController<Uint8Array>, raw: string) => {
          if (!raw) return;
          if (raw === "[DONE]") {
            if (sourceFormat !== "claude") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              doneSent = true;
            }
            return;
          }
          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(raw); } catch { return; }
          if (["response.completed", "response.failed", "response.incomplete", "response.error"].includes(String(parsed.type || ""))) responsesTerminalSeen = true;
          const translated = passthroughFormat ? [parsed] : (translateResponse(providerResponseFormat, sourceFormat, parsed, state) as Record<string, unknown>[] | null);
          for (const chunk of translated || []) {
            summary.add(chunk);
            if (!firstByteTime) firstByteTime = Date.now() - requestStartTime;
            controller.enqueue(sseFrame(encoder, sourceFormat, chunk));
          }
        };
        const handleMessages = (controller: ReadableStreamDefaultController<Uint8Array>, final: boolean) => {
          const messages = buffer.split(/\r?\n\r?\n/);
          buffer = final ? "" : messages.pop() || "";
          for (const message of messages) {
            const raw = sseData(message);
            if (raw) handleRaw(controller, raw);
          }
        };
        // Upstream ended (or failed): emit terminal frames, record Usage and
        // the request detail, close, and return the Connection slot.
        const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
          finished = true;
          finishStarted = true;
          clearStallTimer();
          try {
            // Root emits a terminal Responses failure and [DONE] when an
            // upstream stream ends unexpectedly, preventing compatible
            // clients from waiting indefinitely for a terminal event.
            if (sourceFormat === "openai-responses" && providerResponseFormat === "openai-responses" && !responsesTerminalSeen) {
              controller.enqueue(encoder.encode(`event: response.failed\ndata: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error: { message: "Upstream stream ended without a terminal event" } } })}\n\n`));
            }
            if (sourceFormat === "openai-responses" && !doneSent) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            // Fallback: estimate usage when the provider omits usage metadata
            // from its SSE stream (common for cursor and some OAuth providers).
            const usage = summary.usage();
            recordUsage(runtime, { ...usageCtx, usage, ttftMs: firstByteTime, totalMs: Date.now() - requestStartTime });
            captureDetail(usage, summary.completion(), firstByteTime);
            if (log.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { ttft: firstByteTime, total: Date.now() - requestStartTime } }));
            controller.close();
          } finally {
            endPending();
          }
        };
        // A throw while the stream translates or records a chunk: record the
        // error detail and the Usage so far, return the slot, stop the
        // Provider body, and error the client stream.
        const fail = (controller: ReadableStreamDefaultController<Uint8Array>, error: unknown) => {
          finished = true;
          clearStallTimer();
          const message = error instanceof Error ? error.message : String(error);
          // finish() may have recorded Usage before it threw; record once.
          if (!finishStarted) try {
            if (log.errorLine) log.errorLine(reqTag, "✗", `STREAM ERROR · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${message}`);
            const usage = summary.usage();
            recordUsage(runtime, { ...usageCtx, usage, ttftMs: firstByteTime, totalMs: Date.now() - requestStartTime });
            saveRequestDetail(runtime, buildRequestDetail({
              ...detailBase(),
              latency: { ttft: firstByteTime, total: Date.now() - requestStartTime },
              tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
              providerRequest: translatedBody,
              response: { error: message, status: 502, thinking: null },
              responseHeaders: headersToObject(response.headers),
              status: "error",
            }));
          } catch { /* the slot and the Provider body still close below */ }
          endPending();
          void upstreamReader.cancel(message).catch(() => {});
          try { controller.error(error); } catch { /* already closed */ }
        };
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (finished) return;
            let result: ReadableStreamReadResult<Uint8Array>;
            armStallTimer();
            try {
              result = await upstreamReader.read();
            } catch {
              // A provider read error ends the stream like a normal end.
              result = { done: true, value: undefined };
            } finally {
              clearStallTimer();
            }
            if (finished) return;
            try {
              if (result.done) {
                buffer += decoder.decode();
                handleMessages(controller, true);
                finish(controller);
                return;
              }
              buffer += decoder.decode(result.value, { stream: true });
              handleMessages(controller, false);
            } catch (error) {
              fail(controller, error);
            }
          },
          cancel(reason) {
            finished = true;
            clearStallTimer();
            // Client disconnect: return the slot now, not after the upstream
            // reader settles.
            endPending();
            return upstreamReader.cancel(reason).catch(() => {});
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" } });
      }
      // Upstream answered JSON while the client streams: synthesize a
      // two-frame SSE stream from the converted completion.
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const openai = normalizeToJsonOpenai(payload, providerResponseFormat);
      const finalBody = sourceFormat === "claude" ? toClaude(openai) : sourceFormat === "openai-responses" ? toResponses(openai) : openai;
      let jsonUsage: Record<string, unknown> | null = (openai.usage as Record<string, unknown>) || null;
      if (!jsonUsage) jsonUsage = estimateJsonUsage(sourceBody, openai, sourceFormat);
      recordUsage(runtime, { ...usageCtx, usage: jsonUsage, totalMs: Date.now() - requestStartTime });
      captureDetail(jsonUsage, finalBody);
      if (log.line) log.line(reqTag, "📊", formatDoneLine({ usage: jsonUsage, latency: { ttft: 0, total: Date.now() - requestStartTime } }));
      endPending();
      const encoder = new TextEncoder();
      const frame = sourceFormat === "claude"
        ? `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { ...finalBody, content: [] as any[]} })}\n\nevent: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\nevent: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: textOf(finalBody) } })}\n\nevent: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\nevent: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: finalBody.stop_reason || "end_turn" }, usage: finalBody.usage })}\n\nevent: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
        : `data: ${JSON.stringify(streamChunkOf(finalBody))}\n\ndata: ${JSON.stringify(finalBody)}\n\ndata: [DONE]\n\n`;
      return new Response(encoder.encode(frame), { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" } });
    }

    // Client wants JSON.
    if (isSse && response.body) {
      const chunks: Record<string, unknown>[] = [];
      await transformSse(response.body, providerResponseFormat, "openai", (chunk) => chunks.push(chunk));
      const merged = mergeChunksToCompletion(chunks);
      let usage = sniffUsage(chunks);
      if (!usage) usage = estimateStreamUsage(sourceBody, chunks, sourceFormat);
      recordUsage(runtime, { ...usageCtx, usage, totalMs: Date.now() - requestStartTime });
      captureDetail(usage, merged);
      if (log.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { ttft: 0, total: Date.now() - requestStartTime } }));
      endPending();
      const output = sourceFormat === "claude" ? toClaude(merged) : sourceFormat === "openai-responses" ? toResponses(merged) : merged;
      return Response.json(output, { headers: { "access-control-allow-origin": "*" } });
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const openai = normalizeToJsonOpenai(payload, providerResponseFormat);
    let plainUsage: Record<string, unknown> | null = (openai.usage as Record<string, unknown>) || null;
    if (!plainUsage) plainUsage = estimateJsonUsage(sourceBody, openai, sourceFormat);
    recordUsage(runtime, { ...usageCtx, usage: plainUsage, totalMs: Date.now() - requestStartTime });
    captureDetail(plainUsage, openai);
    if (log.line) log.line(reqTag, "📊", formatDoneLine({ usage: plainUsage, latency: { ttft: 0, total: Date.now() - requestStartTime } }));
    endPending();
    const output = sourceFormat === "claude" ? toClaude(openai) : sourceFormat === "openai-responses" ? toResponses(openai) : openai;
    return Response.json(output, { headers: { "access-control-allow-origin": "*" } });
  }
}
function headersToObject(headers: Headers | Record<string, unknown>): Record<string, unknown> {
  if (!headers) return {};
  if (typeof (headers as Headers).entries === "function") return Object.fromEntries((headers as Headers).entries());
  return { ...(headers as Record<string, unknown>) };
}

function textOf(payload: Record<string, unknown>): string {
  const content = (payload as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => String((part as { text?: string }).text || "")).join("");
  return "";
}

function streamChunkOf(payload: Record<string, unknown>): Record<string, unknown> {
  return { id: payload.id, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: { role: "assistant", content: textOf(payload) }, finish_reason: null }] };
}

function normalizeToJsonOpenai(payload: Record<string, unknown>, providerResponseFormat: string): Record<string, unknown> {
  if (payload.choices) return payload;
  if (Array.isArray(payload.output) || typeof payload.output_text === "string") return fromResponsesShape(payload);
  if (Array.isArray(payload.content) || payload.type === "message") return fromAnthropic(payload);
  // Gemini-family executors answer with {"candidates": [...]} when the
  // upstream call is non-streaming.
  const inner = (payload.response && typeof payload.response === "object" ? payload.response : payload) as Record<string, unknown>;
  if (Array.isArray(inner.candidates)) return fromGeminiShape(payload);
  if (providerResponseFormat !== "openai") return payload;
  return payload;
}

// Single model for chat: all registry-backed providers execute through the
// shared executor path; only deliberately gated providers fall back to v2 core.
async function runSingleChatModel(
  runtime: Runtime,
  input: ChatDispatchInput,
  modelStr: string,
  allowedIds: string[] | null,
  combo: ComboChatContext,
  accountOrder: string[] | null = null,
): Promise<Response> {
  const info = mediaModelInfo(runtime, modelStr);
  if (!info.provider) {
    // Nested combos are not a v1 concept; run the generic path.
    return runtime.gateway.chat({ body: input.body, source: input.source, endpoint: input.endpoint, apiKey: input.apiKey, clientIp: input.clientIp });
  }
  const executorResponse = await runExecutorModel(runtime, { input, provider: info.provider, model: info.model, allowedIds, combo, accountOrder });
  if (executorResponse) return executorResponse;
  return runtime.gateway.chat({ body: input.body, source: input.source, endpoint: input.endpoint, apiKey: input.apiKey, clientIp: input.clientIp });
}

// v1 getComboAccountFilter: null when the model has no entry, [] when the
// entry exists but is not an array (→ "no accounts allowed").
function comboAccountFilter(accountFilters: Record<string, unknown>, modelStr: string): string[] | null {
  if (!accountFilters || !Object.prototype.hasOwnProperty.call(accountFilters, modelStr)) return null;
  return Array.isArray(accountFilters[modelStr]) ? (accountFilters[modelStr] as string[]) : [];
}

const ACCOUNT_GROUP_FILTER_PREFIX = "@group:";

function expandComboGroupFilters(runtime: Runtime, provider: string, filter: string[] | null): string[] | null {
  if (!filter) return null;
  const groups = filter
    .filter((value) => value.startsWith(ACCOUNT_GROUP_FILTER_PREFIX))
    .map((value) => value.slice(ACCOUNT_GROUP_FILTER_PREFIX.length).trim())
    .filter(Boolean);
  if (!groups.length) return filter;
  const ids = new Set(filter.filter((value) => !value.startsWith(ACCOUNT_GROUP_FILTER_PREFIX)));
  for (const connection of runtime.repos.providers.list(true)) {
    if (connection.provider === provider && connection.isActive !== false && groups.includes(String(connection.data.group || "").trim())) ids.add(connection.id);
  }
  return [...ids];
}

function effectiveModelCapabilities(runtime: Runtime, provider: string, model: string) {
  return applyCapabilityOverride(
    getCapabilitiesForModel(provider, model) as Record<string, unknown>,
    capabilityOverrideFor(runtime, provider, model),
  );
}

// Entry point for chat routes. Returns the response, or null when the request
// should stay on the fully generic path (no combo, no specialized executor).
export async function dispatchChat(runtime: Runtime, input: ChatDispatchInput): Promise<Response | null> {
  const requestedModel = String(input.body.model || "");
  if (!requestedModel) return null;

  const info = mediaModelInfo(runtime, requestedModel);
  const blocked = enforceApiKeyAccess(input.apiKey, requestedModel, { isCombo: info.isCombo === true });
  if (blocked) return blocked;

  // Debug: log what body shape we received for vision diagnosis.
  const bodyAny = input.body as Record<string, any>;
  const hasMessages = Array.isArray(bodyAny.messages);
  const hasInput = Array.isArray(bodyAny.input);
  const msgCount = hasMessages ? bodyAny.messages.length : 0;
  const inputCount = hasInput ? bodyAny.input.length : 0;
  let blockTypes: string[] = [];
  const collectBlocks = (content: any) => { if (Array.isArray(content)) for (const b of content) if (b?.type) blockTypes.push(b.type); };
  if (hasMessages) for (const m of bodyAny.messages) collectBlocks(m?.content);
  if (hasInput) for (const it of bodyAny.input) collectBlocks(it?.content);
  log.info("DISPATCH", `dispatchChat model="${requestedModel}" source=${input.source} messages=${msgCount} input=${inputCount} blockTypes=[${blockTypes.join(",")}]`, {});

  // v1 runs the bypass check before combo rotation so warmup/title requests
  // never consume rotation slots.
  const bypass = tryBypassRequest(runtime, input.body, requestedModel, input.userAgent || "");
  if (bypass) return bypass;

  if (info.isCombo && info.comboModels?.length) {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const strategyConfig = ((settings.comboStrategies || {})[info.model] || {}) as Record<string, any>;
    const comboStrategy = strategyConfig.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = Number(settings.comboStickyRoundRobinLimit ?? 1) || 1;
    const comboRow = runtime.repos.combos.get(info.model) || {};
    const accountFilters = (() => { try { return JSON.parse(String((comboRow as { accountFilters?: string }).accountFilters || "{}")); } catch { return {}; } })();
    const comboName = String((comboRow as { name?: string }).name || info.model);
    const combo: ComboChatContext = { comboIdentityName: (comboRow as { identityEnabled?: boolean }).identityEnabled ? comboName : null, comboName };
    const customOrder = (comboRow as { useCustomAccountOrder?: boolean }).useCustomAccountOrder === true;

    const runComboModel = (body: Record<string, unknown>, modelStr: string): Promise<Response> => {
      const filter = comboAccountFilter(accountFilters, modelStr);
      if (Array.isArray(filter) && filter.length === 0) {
        return Promise.resolve(errorBody(errorSource(input.source), 503, `No accounts allowed for combo model: ${modelStr}`));
      }
      // Intersect the combo account filter with the event key's connection
      // pins for this combo + model (when the key pins any).
      const pinned = pinnedConnectionIds(input.apiKey, comboName, modelStr);
      let allowed = expandComboGroupFilters(runtime, mediaModelInfo(runtime, modelStr).provider || "", filter);
      if (Array.isArray(pinned)) {
        allowed = Array.isArray(allowed) ? allowed.filter((id) => pinned.includes(id)) : [...pinned];
        if (allowed.length === 0) {
          return Promise.resolve(errorBody(errorSource(input.source), 503, `No pinned connections available for combo model: ${modelStr}`));
        }
      }
      const accountOrder = customOrder && Array.isArray(allowed) ? allowed : null;
      const provider = mediaModelInfo(runtime, modelStr).provider;
      return runSingleChatModel(runtime, { ...input, body }, modelStr, allowed, combo, accountOrder);
    };

    if (comboStrategy === "fusion") {
      return handleFusionChat({
        body: input.body,
        models: info.comboModels,
        handleSingleModel: (body: Record<string, unknown>, modelStr: string) => runComboModel(body, modelStr),
        log,
        comboName: info.model,
        judgeModel: strategyConfig.judgeModel,
        tuning: strategyConfig.fusionTuning,
        errorSource: errorSource(input.source),
      }) as Promise<Response>;
    }

    // Vision adapter augmentation: if the request needs vision/audio and none
    // of the combo's models support it, prepend vision adapter models.
    const required = detectRequiredCapabilities(input.body) as Set<string>;
    log.info("COMBO", `detectRequiredCapabilities → [${[...required].join(",")}] for combo "${info.model}" with models [${info.comboModels.join(", ")}]`, {});
    const resolveCaps = (providerAlias: string, modelId: string) => effectiveModelCapabilities(runtime, providerAlias, modelId);
    const augmented = augmentWithVisionAdapter(info.comboModels, required, runtime.repos, log, resolveCaps);
    if (augmented.adapterAdded) {
      log.info("COMBO", `vision-adapter augmentation complete: prepended ${augmented.models.length - info.comboModels.length} model(s)`, {});
    }

    return handleComboChat({
      body: input.body,
      models: augmented.models,
      handleSingleModel: (body: Record<string, unknown>, modelStr: string) => runComboModel(body, modelStr),
      log,
      comboName: info.model,
      comboStrategy,
      comboStickyLimit,
      errorSource: errorSource(input.source),
      resolveCaps,
    }) as Promise<Response>;
  }

  if (!info.provider) return null;
  const executorResponse = await runExecutorModel(runtime, { input, provider: info.provider, model: info.model, allowedIds: null, combo: { comboIdentityName: null, comboName: null }, accountOrder: null });
  return executorResponse;
}
