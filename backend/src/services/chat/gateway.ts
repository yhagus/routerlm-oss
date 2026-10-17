import type { BackendConfig } from "../../config";
import type { ApiKeyRecord, ProviderConnection, Repositories } from "../../db/repositories";
import type { AuthService } from "../platform/auth";
import { translateSse } from "./sseTranslate";
import { gatewayModels } from "../providers/modelCatalog";
import { currentBackoffLevel, errorMessage, fallbackState, laterUntil, storedConnection, unavailableUntil } from "./fallback";
import { gatewayErrorResponse } from "./gatewayError";
import { attemptFailed, connectionsBusyResponse, fallbackAttempts, nextConnectionAttempt } from "./connectionAttempt";
import { connectionsWithFreeSlots, type ConnectionSelection } from "./credentials";
import { releaseWhenDone } from "./admission";
import { credentialToken, providerTokenRefresh, refreshAfterAuthFailure } from "../providers/refreshCoordinator";
import { inferProviderPrefix, enforceApiKeyAccess } from "../media/shared";
import { resolveProviderId } from "../providers/providerCatalog";

export interface GatewayInput {
  body: Record<string, unknown>;
  source: "openai" | "claude" | "responses" | "ollama";
  endpoint: string;
  apiKey?: ApiKeyRecord | null;
  clientIp?: string;
}

export interface Gateway {
  chat(input: GatewayInput): Promise<Response>;
  models(kind?: string): Record<string, unknown>[];
  countTokens(body: Record<string, unknown>): number;
}

const json = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

// Usage metadata for the generic gateway path: combo identity plus the
// latency-derived throughput fields the public status page aggregates (avg t/s,
// avg latency, per-request t/s). Mirrors recordUsage in chat.ts.
function metaForUsage(comboName: string | null, startedAt: number, usage: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = comboName ? { comboName } : {};
  const totalMs = Date.now() - startedAt;
  if (totalMs > 0) {
    meta.totalMs = Math.round(totalMs);
    const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
    if (completion > 0) {
      meta.tokensPerSecond = Math.round((completion / (totalMs / 1000)) * 100) / 100;
    }
  }
  return meta;
}

function messagesFromInput(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) return input.map((item) => typeof item === "string" ? { role: "user", content: item } : json(item));
  if (typeof input === "string") return [{ role: "user", content: input }];
  return [];
}

function toOpenAi(body: Record<string, unknown>, source: GatewayInput["source"]): Record<string, unknown> {
  if (source === "openai" || source === "ollama") return { ...body };
  if (source === "responses") return { ...body, messages: messagesFromInput(body.input), stream: body.stream ?? false };
  const messages: Record<string, unknown>[] = [];
  if (body.system) messages.push({ role: "system", content: typeof body.system === "string" ? body.system : JSON.stringify(body.system) });
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const value = json(message);
    const content = Array.isArray(value.content)
      ? value.content.map((part) => { const item = json(part); return item.type === "text" ? item.text : item; })
      : value.content;
    messages.push({ ...value, content });
  }
  return { ...body, messages, max_tokens: body.max_tokens ?? body.max_tokens_to_sample, stream: body.stream ?? false };
}

function toAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages.map((message) => {
    const item = json(message);
    return { role: item.role === "assistant" ? "assistant" : "user", content: item.content ?? "" };
  }).filter((message) => message.content !== "") : [];
  const system = Array.isArray(body.messages) ? body.messages.map(json).filter((message) => message.role === "system").map((message) => message.content).join("\n") : undefined;
  return {
    model: body.model,
    max_tokens: Number(body.max_tokens || body.max_completion_tokens || 4096),
    messages,
    ...(system ? { system } : {}),
    ...(body.stream != null ? { stream: body.stream } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.tools ? { tools: body.tools } : {}),
  };
}

function providerBody(body: Record<string, unknown>, source: GatewayInput["source"], connection: ProviderConnection): Record<string, unknown> {
  const openAi = toOpenAi(body, source);
  if (connection.apiType === "anthropic") return toAnthropic(openAi);
  if (connection.apiType === "responses") return source === "responses" ? body : { ...body, model: body.model };
  return openAi;
}

function toClaude(response: Record<string, unknown>): Record<string, unknown> {
  const choice = json(Array.isArray(response.choices) ? response.choices[0] : {});
  const message = json(choice.message);
  const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content || []);
  const usage = json(response.usage);
  return {
    id: String(response.id || `msg_${crypto.randomUUID().replaceAll("-", "")}`),
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: choice.finish_reason === "stop" ? "end_turn" : choice.finish_reason || null,
    stop_sequence: null,
    usage: { input_tokens: Number(usage.prompt_tokens || 0), output_tokens: Number(usage.completion_tokens || 0) },
  };
}

function toResponses(response: Record<string, unknown>): Record<string, unknown> {
  const choice = json(Array.isArray(response.choices) ? response.choices[0] : {});
  const message = json(choice.message);
  const text = typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map((item) => typeof item === "string" ? item : json(item).text || "").join("") : "";
  const usage = json(response.usage);
  return { id: String(response.id || `resp_${crypto.randomUUID().replaceAll("-", "")}`), object: "response", model: response.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], output_text: text, usage: { input_tokens: Number(usage.prompt_tokens || 0), output_tokens: Number(usage.completion_tokens || 0), total_tokens: Number(usage.total_tokens || 0) } };
}

function fromAnthropic(response: Record<string, unknown>): Record<string, unknown> {
  const content = Array.isArray(response.content) ? response.content : [];
  const text = content.map((part) => { const item = json(part); return typeof item.text === "string" ? item.text : ""; }).join("");
  const usage = json(response.usage);
  return {
    id: response.id || `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    model: response.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: response.stop_reason || "stop" }],
    usage: { prompt_tokens: Number(usage.input_tokens || 0), completion_tokens: Number(usage.output_tokens || 0), total_tokens: Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0) },
  };
}

const ACCOUNT_GROUP_FILTER_PREFIX = "@group:";

function dynamicGroupName(value: string): string | null {
  const name = value.startsWith(ACCOUNT_GROUP_FILTER_PREFIX) ? value.slice(ACCOUNT_GROUP_FILTER_PREFIX.length).trim() : "";
  return name || null;
}

// Connection ids an "event" key pins for a given combo + model. Returns null
// when the key has no pin for the pair (pool stays untouched), an array
// (possibly empty) when a pin exists.
export function pinnedConnectionIds(apiKey: ApiKeyRecord | null | undefined, comboName: string | null, model: string): string[] | null {
  if (!apiKey || apiKey.visibility !== "event" || !comboName) return null;
  const pins = apiKey.connectionPins;
  if (!pins || typeof pins !== "object") return null;
  const entry = (pins as Record<string, Record<string, string[]>>)[comboName];
  if (!entry || typeof entry !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(entry, model)) return null;
  return Array.isArray(entry[model]) ? entry[model] : [];
}

function expandAccountFilter(filter: string[], connections: Array<{ id: string; data: Record<string, unknown> }>): string[] {  const allowed = new Set(filter.filter((value) => !dynamicGroupName(value)));
  const groups = new Set(filter.map(dynamicGroupName).filter((value): value is string => Boolean(value)));
  for (const connection of connections) {
    if (groups.has(String(connection.data.group || "").trim())) allowed.add(connection.id);
  }
  return [...allowed];
}

function targetForModel(model: string, aliases: Record<string, string>, combos: Repositories["combos"]): { model: string; candidates: string[]; accountFilters: Record<string, string[]>; useCustomAccountOrder: boolean } {
  const aliased = aliases[model] || model;
  const combo = combos.get(aliased);
  if (combo) {
    let candidates: string[] = [];
    let accountFilters: Record<string, string[]> = {};
    try { candidates = JSON.parse(String(combo.models || "[]")); } catch { candidates = []; }
    try { accountFilters = JSON.parse(String(combo.accountFilters || combo.account_filters || "{}")); } catch { accountFilters = {}; }
    candidates = candidates.filter((candidate) => typeof candidate === "string" && candidate);
    return { model: candidates[0] || model, candidates: candidates.length ? candidates : [model], accountFilters, useCustomAccountOrder: combo.useCustomAccountOrder === true || combo.use_custom_account_order === 1 };
  }
  return { model: aliased, candidates: [aliased], accountFilters: {} as Record<string, any>, useCustomAccountOrder: false };
}

function providerFromModel(model: string): { provider: string; model: string } {
  const slash = model.indexOf("/");
  if (slash > 0) return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
  // Bare model ids: v1 prefix inference (e.g. "gemini-3.1-pro" -> gemini) with
  // the media stack's OpenAI default.
  return { provider: inferProviderPrefix(model), model };
}

function connectionBase(connection: ProviderConnection): string | null {
  const data = connection.data;
  const base = connection.baseUrl || (typeof data.baseUrl === "string" ? data.baseUrl : null) || (typeof data.base_url === "string" ? data.base_url : null);
  return base?.replace(/\/$/, "") || null;
}

function upstreamUrl(connection: ProviderConnection, source: GatewayInput["source"], endpoint: string): string | null {
  const base = connectionBase(connection);
  if (!base) return null;
  if (/\/chat\/completions$|\/messages$|\/responses$|\/embeddings$|\/speech$/.test(base)) return base;
  if (connection.apiType === "anthropic") return `${base}/v1/messages`;
  if (connection.apiType === "responses") return `${base}/v1/responses`;
  return `${base}${base.endsWith("/v1") ? endpoint.replace(/^\/v1/, "") : endpoint}`;
}

function credentials(connection: ProviderConnection): Record<string, unknown> {
  return { ...connection.data, ...connection.credentials };
}

function recordStreamingUsage(body: ReadableStream<Uint8Array>, onUsage: (usage: Record<string, unknown>) => void, onComplete?: () => void): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const finish = () => { if (!completed) { completed = true; onComplete?.(); } };
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const event = JSON.parse(raw) as Record<string, unknown>;
          const usage = event.usage;
          if (usage && typeof usage === "object") onUsage(usage as Record<string, unknown>);
        } catch { /* non-JSON SSE events are passed through */ }
      }
    },
    flush() {
      buffer += decoder.decode();
      if (!buffer.startsWith("data:")) return;
      try {
        const event = JSON.parse(buffer.slice(5).trim()) as Record<string, unknown>;
        if (event.usage && typeof event.usage === "object") onUsage(event.usage as Record<string, unknown>);
      } catch { /* ignore incomplete provider frames */ }
      finish();
    },
    // NOTE: TransformStream has no `cancel` hook in the TS lib types. If the
    // downstream client cancels mid-stream, flush() does not run, so the
    // caller's onComplete may not fire here. The caller wraps the stream in
    // releaseWhenDone, which releases the Connection slot on cancel.
  }));
}

export function createGateway(_config: BackendConfig, repos: Repositories, _auth: AuthService, sqlite?: { query(sql: string): { all(): unknown[] } }): Gateway {
  return {
    countTokens(body) {
      const value = JSON.stringify(body);
      return Math.ceil(value.length / 4);
    },
    models(kind = "llm") {
      return gatewayModels(repos, sqlite || { query: () => ({ all: () => [] }) }, kind);
    },
    async chat(input) {
      const requestedModel = String(input.body.model || "");
      const aliasMap = repos.aliases.list();
      const target = targetForModel(requestedModel, aliasMap, repos.combos);
      const comboRecord = repos.combos.get(aliasMap[requestedModel] || requestedModel);
      const comboName = comboRecord ? String(comboRecord.name || requestedModel) : null;
      const blocked = enforceApiKeyAccess(input.apiKey, requestedModel, { isCombo: Boolean(comboRecord) });
      if (blocked) return blocked;
      let lastError: Response | null = null;
      const settings = repos.settings.get() as Record<string, any>;
      const slotOwner = { repos };
      // One Fallback cap across every candidate model of the request.
      const attempts = fallbackAttempts(settings);
      let saturated = false;
      candidates: for (const candidate of target.candidates) {
        const parsed = providerFromModel(candidate);
        // Dashboard model tests use UI aliases (for example, cc/...), while
        // provider connections are persisted under their canonical IDs.
        const resolved = { ...parsed, provider: resolveProviderId(parsed.provider) };
        let connections = repos.providers.select(resolved.provider, resolved.model);
        const accountFilter = target.accountFilters[candidate];
        // An event key's connection pins narrow the pool further, on top of
        // any combo account filter.
        const pinnedIds = pinnedConnectionIds(input.apiKey, comboName, candidate);
        if (Array.isArray(pinnedIds)) connections = connections.filter((connection) => pinnedIds.includes(connection.id));
        if (Array.isArray(accountFilter)) {
          const allowedIds = expandAccountFilter(accountFilter, connections);
          if (!allowedIds.length) continue;
          connections = connections.filter((connection) => allowedIds.includes(connection.id));
          if (target.useCustomAccountOrder) connections.sort((left, right) => {
            const leftIndex = accountFilter.indexOf(left.id);
            const rightIndex = accountFilter.indexOf(right.id);
            return (leftIndex < 0 ? Number.POSITIVE_INFINITY : leftIndex) - (rightIndex < 0 ? Number.POSITIVE_INFINITY : rightIndex);
          });
        }
        const withUrl = connections.filter((connection) => upstreamUrl(connection, input.source, input.endpoint));
        if (withUrl.length < connections.length) lastError = gatewayErrorResponse(503, input.source, `Provider ${resolved.provider} has no base URL`);
        // The same in-flight filter as chat selection: the first Connection
        // in order with a free slot.
        const select = (excludeIds: Set<string>): ConnectionSelection => {
          const free = connectionsWithFreeSlots(slotOwner, settings, resolved.provider, withUrl.filter((connection) => !excludeIds.has(connection.id)));
          if (free.saturated) return { selected: null, remaining: 0, saturated: true };
          const connection = free.connections[0];
          return connection ? { selected: { connection, credentials: credentials(connection), synthetic: false }, remaining: free.connections.length - 1 } : { selected: null, remaining: 0 };
        };
        while (true) {
          const step = nextConnectionAttempt(slotOwner, attempts, select, { provider: resolved.provider, model: resolved.model, apiKey: input.apiKey?.key || null });
          if (step.kind === "capped") break candidates;
          if (step.kind === "saturated") saturated = true;
          if (step.kind !== "attempt") continue candidates;
          const connection = step.selected.connection;
          const url = upstreamUrl(connection, input.source, input.endpoint)!;
          const auth = credentials(connection);
          const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream" });
          const token = auth.apiKey || auth.accessToken || auth.token;
          if (token) {
            if (connection.apiType === "anthropic") headers.set("x-api-key", String(token));
            else headers.set("authorization", `Bearer ${token}`);
          }
          if (connection.apiType === "anthropic") headers.set("anthropic-version", "2023-06-01");
          const body = providerBody({ ...input.body, model: resolved.model }, input.source, connection);
          // The Connection slot also drives the dashboard pending tracking.
          // A returned stream keeps it until the stream ends or is cancelled.
          const closePending = () => step.slot?.release();
          let streamOwnsSlot = false;
          try {
            const startedAt = Date.now();
            let response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
            if ((response.status === 401 || response.status === 403) && credentials(connection).refreshToken) {
              // The coordinator stores only the refreshed token fields, so an
              // omitted id_token keeps the stored idToken.
              const refreshed = await refreshAfterAuthFailure({ repos }, connection.id, token ? String(token) : null, { refresh: providerTokenRefresh });
              const retryToken = credentialToken(refreshed);
              if (retryToken) {
                const retryHeaders = new Headers(headers);
                if (connection.apiType === "anthropic") retryHeaders.set("x-api-key", retryToken);
                else retryHeaders.set("authorization", `Bearer ${retryToken}`);
                await response.body?.cancel().catch(() => {});
                response = await fetch(url, { method: "POST", headers: retryHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
              }
            }
            if (!response.ok) {
              const text = await response.text();
              repos.usage.noteError(resolved.provider);
              const state = fallbackState(response.status, errorMessage(response.status, text), currentBackoffLevel(repos, connection));
              repos.providers.patch(connection.id, { data: { rateLimitedUntil: laterUntil(storedConnection(repos, connection).data.rateLimitedUntil, unavailableUntil(state.cooldownMs)), backoffLevel: state.backoffLevel, lastError: errorMessage(response.status, text), lastErrorAt: new Date().toISOString(), testStatus: "error" } });
              lastError = gatewayErrorResponse(response.status, input.source, text);
              attemptFailed(attempts, connection.id, response.status, text);
              continue;
            }
            const contentType = response.headers.get("content-type") || "";
            if (body.stream && contentType.includes("text/event-stream")) {
              const target = input.source === "claude" && connection.apiType !== "anthropic" ? "claude" : input.source !== "claude" && connection.apiType === "anthropic" ? "openai" : null;
              const translated = target && response.body ? translateSse(response.body, target) : response.body;
              const stream = translated ? recordStreamingUsage(translated, (usage) => {
                repos.providers.patch(connection.id, { data: { rateLimitedUntil: null, backoffLevel: 0, lastError: null, lastErrorAt: null, testStatus: "ok" } });
                repos.usage.record({ provider: resolved.provider, model: resolved.model, connectionId: connection.id, apiKey: input.apiKey?.key, endpoint: input.endpoint, clientIp: input.clientIp, promptTokens: usage.prompt_tokens || usage.input_tokens, completionTokens: usage.completion_tokens || usage.output_tokens, tokens: usage, meta: metaForUsage(comboName, startedAt, usage) });
              }, closePending) : null;
              streamOwnsSlot = true;
              return releaseWhenDone(new Response(stream, { status: response.status, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" } }), closePending);
            }
            const payload = json(await response.json());
            const usage = json(payload.usage);
            repos.usage.record({ provider: resolved.provider, model: resolved.model, connectionId: connection.id, apiKey: input.apiKey?.key, endpoint: input.endpoint, clientIp: input.clientIp, promptTokens: usage.prompt_tokens || usage.input_tokens, completionTokens: usage.completion_tokens || usage.output_tokens, tokens: usage, meta: metaForUsage(comboName, startedAt, usage) });
            if (input.apiKey) repos.keys.incrementUsage(input.apiKey.id, Number(usage.total_tokens || Number(usage.prompt_tokens || usage.input_tokens || 0) + Number(usage.completion_tokens || usage.output_tokens || 0)));
            closePending();
            const output = input.source === "claude"
              ? connection.apiType === "anthropic" ? payload : toClaude(payload)
              : input.source === "responses"
                ? connection.apiType === "responses" ? payload : toResponses(payload)
                : connection.apiType === "anthropic" ? fromAnthropic(payload) : payload;
            return Response.json(output);
          } catch (error: any) {
            closePending();
            const message = error instanceof Error ? error.message : "Upstream request failed";
            repos.usage.noteError(resolved.provider);
            const state = fallbackState(502, message, currentBackoffLevel(repos, connection));
            repos.providers.patch(connection.id, { data: { rateLimitedUntil: laterUntil(storedConnection(repos, connection).data.rateLimitedUntil, unavailableUntil(state.cooldownMs)), backoffLevel: state.backoffLevel, lastError: message, lastErrorAt: new Date().toISOString(), testStatus: "error" } });
            lastError = gatewayErrorResponse(502, input.source, message);
            attemptFailed(attempts, connection.id, 502, message);
          } finally {
            if (!streamOwnsSlot) closePending();
          }
        }
      }
      if (lastError) return lastError;
      if (saturated) return connectionsBusyResponse(input.source);
      return gatewayErrorResponse(503, input.source, "No provider account is available");
    },
  };
}
