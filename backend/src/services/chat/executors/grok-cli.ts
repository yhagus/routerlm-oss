import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../../providers/config/providers.ts";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../../providers/oauth/oauthCredentialManager.ts";
import { normalizeResponsesInput } from "../translator/formats/responsesApi.js";
import { getModelUpstreamId } from "../../providers/config/providerModels.ts";
import {
  GROK_CLI_AUTHENTICATE_RESPONSE,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_CLIENT_MODE,
  GROK_CLI_TOKEN_AUTH,
  GROK_CLI_VERSION,
  GROK_CLI_XAI_BASE_URL,
  GROK_CLI_USER_AGENT,
  isGrokCliProxyUrl,
  supportsGrokCliReasoningEffort,
} from "../../providers/config/grokCli.ts";
import { getGrokCliModelInfo } from "../../providers/config/grokCliModels.ts";
import { getCachedGrokCliModelInfo } from "../../providers/discovery/grokCliModels.ts";
import { SUPPORTED_HOSTED_TOOLS } from "../../providers/config/grokCliCapabilities.ts";
import { resolveSessionId } from "../utils/sessionManager.js";
import { getConsistentMachineId } from "../../providers/cli-auth/machineId.ts";
import { prepareGrokCliCompaction } from "../grokCliCompaction.js";
import { getQuotaTracker } from "../../billing/quotaTracker.js";
import { QuotaMode, type QuotaModeValue } from "../../billing/quotaModes.js";
import { parseRateLimitMetadata, buildRateLimitResponseHeaders } from "../../billing/rateLimitParser.js";
import { gunzipSync } from "node:zlib";
import { isGrokCliFreeUsageExhausted } from "../../providers/grokCliQuotaFamily.js";

const GROK_CLI_PROVIDER = "grok-cli";

// Decompress gzip response body
async function decompressGzip(response: Response): Promise<Response> {
  const buffer = await response.arrayBuffer();
  const decompressed = gunzipSync(Buffer.from(buffer));
  const newHeaders = new Headers(response.headers);
  newHeaders.delete("content-encoding");
  newHeaders.set("content-length", String(decompressed.length));
  return new Response(decompressed, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// Wrap streaming response with semantic idle timeout
// Times out if no useful output (non-whitespace, non-comment) arrives within idleTimeout
function wrapWithSemanticIdle(response: Response, idleTimeout: number): Response {
  if (!response.body) return response;

  let lastUsefulOutput = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = new AbortController();

  const resetTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(new Error(`Stream idle timeout: no useful output for ${idleTimeout}ms`));
    }, idleTimeout);
  };

  const isUsefulOutput = (text: string): boolean => {
    // Check if the chunk contains useful output (not just whitespace, comments, or heartbeats)
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, comments, and SSE heartbeats
      if (trimmed && !trimmed.startsWith(":") && !trimmed.startsWith("event: ping") && !trimmed.startsWith("event:keepalive")) {
        return true;
      }
    }
    return false;
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      if (isUsefulOutput(text)) {
        lastUsefulOutput = Date.now();
        resetTimer();
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (timer) clearTimeout(timer);
    },
  });

  // Start the timer
  resetTimer();

  // Wrap the body with the transform stream
  const wrappedBody = response.body.pipeThrough(transform);

  // Create a new response with the wrapped body
  const newResponse = new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  // Attach the abort signal to the response
  (newResponse as any).__idleAbortController = controller;

  return newResponse;
}

// Server-generated item id prefixes that /responses cannot resolve when store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

// Hosted tool types executed server-side by Grok CLI backend
const HOSTED_TOOL_TYPES = new Set(SUPPORTED_HOSTED_TOOLS);

// Fields accepted by cli-chat-proxy Responses API (mirrors Codex allowlist + Grok extras)
const RESPONSES_API_ALLOWLIST = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "stream",
  "store",
  "reasoning",
  "include",
  "temperature",
  "top_p",
  "max_output_tokens",
  "parallel_tool_calls",
  "stream_tool_calls",
  "text",
  "metadata",
  "prompt_cache_key",
  "previous_response_id",
  "_compact",
]);

const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const GROK_CLI_NATIVE_ITEM_ID = /^(?:rs|msg|fc)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROK_CLI_REPLAYABLE_ITEM_TYPES = new Set([
  "message",
  "web_search_call",
  "x_search_call",
  "code_interpreter_call",
  "mcp_call",
  "shell_call",
]);
const GROK_CLI_FREEFORM_TOOL_PARAMETERS = {
  type: "object",
  properties: { input: { type: "string" } },
  required: ["input"],
};
const GROK_CLI_APPLY_PATCH_PARAMETERS = {
  type: "object",
  properties: {
    operation: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["create_file", "update_file", "delete_file"] },
        path: { type: "string", minLength: 1 },
        diff: { type: "string" },
      },
      required: ["type", "path"],
      additionalProperties: false,
    },
  },
  required: ["operation"],
  additionalProperties: false,
};

export class GrokCliCompatibilityError extends Error {
  name: any;
  status: any;
  constructor(message: any) {
    super(message);
    this.name = "GrokCliCompatibilityError";
    this.status = 400;
  }
}

function extractGrokCliErrorText(bodyText: any) {
  try {
    const payload = JSON.parse(bodyText);
    const nested = payload?.error && typeof payload.error === "object" ? payload.error : {};
    return {
      code: String(nested.code || payload?.code || "").toLowerCase(),
      message: String(nested.message || payload?.error || payload?.message || "").toLowerCase().trim(),
    };
  } catch {
    return { code: "", message: String(bodyText || "").toLowerCase().trim() };
  }
}

export function shouldUseGrokCliXaiFallback(credentials: any, status: any, bodyText: any) {
  if (status !== 403) return false;
  const tier = String(credentials?.providerSpecificData?.subscriptionTier || "");
  if (!/supergrok/i.test(tier)) return false;

  const { code, message } = extractGrokCliErrorText(bodyText);
  if (code.includes("blocked-user") || message === "user is blocked") return false;
  return !message.includes("content violates usage guidelines") && !message.includes("safety_check_type_");
}

// Retained for test/API compatibility; turn values are never fabricated.
const sessionTurnStore = new Map();

/**
 * Count user turns in a Responses `input` array.
 * Official CLI sets x-grok-turn-idx to the 1-based conversation turn (≈ user messages).
 * HAR: first chat turn → "1".
 */
export function countGrokCliUserTurns(input: any) {
  if (!Array.isArray(input)) return 1;
  let n = 0;
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const type = typeof item.type === "string" ? item.type : "";
    // Responses message items (type omitted or "message") with role user
    if (item.role === "user" && (!type || type === "message")) n += 1;
  }
  return Math.max(1, n);
}

/**
 * Resolve monotonic turn index for a session.
 * Prefers user-message count from the payload (full history clients), but never
 * decreases vs the last index observed for the same sessionId in this process.
 */
export function resolveGrokCliTurnIdx(sessionId: any, input: any, requestKey: any = null) {
  const value = typeof requestKey === "string" ? requestKey.trim() : "";
  return /^(?:0|[1-9][0-9]*)$/.test(value) && value.length <= 20 ? value : "";
}

/** Test helper — clear in-memory turn counters */
export function _resetGrokCliTurnStore() {
  sessionTurnStore.clear();
}

export function _getGrokCliTurnStoreSize() {
  return sessionTurnStore.size;
}

export function normalizeGrokCliEffort(value: any) {
  const effort = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (effort === "none") return "none";
  if (EFFORT_LEVELS.includes(effort)) return effort;
  return "high";
}

export { supportsGrokCliReasoningEffort } from "../../providers/config/grokCli.ts";

import { getReasoningReplay } from "../reasoningReplay/index.js";
import { scopedReplayKey } from "../reasoningReplay/scopedKey.js";
import {
  recoverReasoningDecodeFailure,
  isReasoningDecodeFailure,
} from "../reasoningReplay/recovery.js";

export function resolveGrokCliSessionId(credentials: any, body: any) {
  // ponytail: clients without stable thread metadata share one connection session;
  // split further when their wire format exposes a durable conversation id.
  const explicitSessionBody = {
    prompt_cache_key: body?.prompt_cache_key,
    session_id: body?.session_id,
    conversation_id: body?.conversation_id,
    metadata: body?.metadata,
  };

  return resolveSessionId({
    headers: credentials?.rawHeaders,
    body: explicitSessionBody,
    connectionId: credentials?.connectionId || credentials?.id,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: "grok-cli",
  });
}

function stringifyGrokCliToolOutput(output: any) {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  return JSON.stringify(output);
}

function createGrokCliToolAlias(namespace: any, name: any, aliases: any) {
  const base = `${namespace}${namespace.endsWith("__") ? "" : "__"}${name}`;
  let alias = base.length <= 128 ? base : `${base.slice(0, 116)}__${crypto.createHash("sha256").update(base).digest("hex").slice(0, 9)}`;
  if (aliases.has(alias)) {
    alias = `${alias.slice(0, 116)}__${crypto.createHash("sha256").update(`${namespace}\0${name}`).digest("hex").slice(0, 9)}`;
  }
  return alias;
}

function flattenGrokCliNamespaces(body: any) {
  if (!Array.isArray(body.tools)) return;
  const aliases = new Map();
  const tools: any[] = [];
  for (const tool of body.tools) {
    if (tool?.type !== "namespace") {
      tools.push(tool);
      continue;
    }
    const namespace = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!namespace || !Array.isArray(tool.tools)) {
      throw new GrokCliCompatibilityError("Grok CLI namespace tools require a name and function tool list.");
    }
    for (const child of tool.tools) {
      const name = typeof child?.name === "string" ? child.name.trim() : "";
      if (child?.type !== "function" || !name) {
        throw new GrokCliCompatibilityError("Grok CLI namespace tools may only contain named function tools.");
      }
      const alias = createGrokCliToolAlias(namespace, name, aliases);
      aliases.set(alias, { name, namespace });
      tools.push({ ...child, name: alias });
    }
  }
  body.tools = tools;
  if (aliases.size > 0) {
    Object.defineProperty(body, "_grokCliToolAliases", { value: aliases, enumerable: false });
  }
}

function normalizeGrokCliLegacyShellTools(body: any) {
  if (!Array.isArray(body.tools)) return;
  let hasShell = false;
  let hasLocalShell = false;
  body.tools = body.tools.map((tool: any) => {
    if (tool?.type === "shell") {
      hasShell = true;
      return tool;
    }
    if (tool?.type === "local_shell") {
      hasLocalShell = true;
      return { type: "shell", environment: { type: "local" } };
    }
    return tool;
  });
  if (hasShell && hasLocalShell) {
    throw new GrokCliCompatibilityError("Grok CLI accepts either shell or local_shell, not both in one request.");
  }
}

function isNativeGrokCliItemId(id: any) {
  return typeof id === "string" && GROK_CLI_NATIVE_ITEM_ID.test(id);
}

function normalizeGrokCliInputItem(item: any) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const { internal_chat_message_metadata_passthrough: _metadata, ...clean } = item;

  if (item.type === "item_reference") return null;

  if (item.type === "reasoning") {
    if (!isNativeGrokCliItemId(item.id) || typeof item.encrypted_content !== "string") return null;
    return clean;
  }

  if (item.type === "custom_tool_call") {
    const callId = item.call_id || item.id;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!callId || !name) return null;
    return {
      type: "function_call",
      call_id: callId,
      name,
      arguments: JSON.stringify({ input: stringifyGrokCliToolOutput(item.input ?? item.arguments) }),
    };
  }

  if (item.type === "custom_tool_call_output" || item.type === "function_call_output") {
    const callId = item.call_id || item.id;
    if (!callId) return null;
    return {
      type: "function_call_output",
      call_id: callId,
      output: stringifyGrokCliToolOutput(item.output),
    };
  }

  if (item.type === "function_call") {
    const callId = item.call_id || item.id;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!callId || !name) return null;
    return {
      type: "function_call",
      ...(isNativeGrokCliItemId(item.id) ? { id: item.id } : {}),
      call_id: callId,
      name,
      arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
      ...(typeof item.status === "string" ? { status: item.status } : {}),
    };
  }

  if (!item.type || GROK_CLI_REPLAYABLE_ITEM_TYPES.has(item.type)) return clean;

  // Do not send unknown Responses items to Grok: it rejects the whole next
  // turn. Keep a compact boundary so the model knows prior tool state exists.
  return {
    type: "message",
    role: "developer",
    content: `[Prior ${item.type} state is not replayable by Grok CLI.]`,
  };
}

export function normalizeGrokCliInput(body: any) {
  if (!Array.isArray(body?.input)) return body;
  const normalized = body.input.map(normalizeGrokCliInputItem).filter(Boolean);
  const callIds = new Set(
    normalized
      .filter((item: any) => item?.type === "function_call" && item.call_id)
      .map((item: any) => item.call_id)
  );
  body.input = normalized.filter(
    (item: any) => item?.type !== "function_call_output" || callIds.has(item.call_id)
  );
  return body;
}

function stripStoredItemReferences(body: any) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item: any) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (item.type === "item_reference") return false;
      if (
        typeof item.id === "string" &&
        SERVER_ID_PATTERN.test(item.id) &&
        !isNativeGrokCliItemId(item.id)
      ) delete item.id;
    }
    return true;
  });
}

/**
 * Flatten Chat Completions tool shape → Responses flat format.
 * Keep hosted tools (web_search / x_search) passthrough.
 */
function normalizeGrokCliTools(body: any) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) {
    delete body.tools;
    delete body.tool_choice;
    return;
  }
  normalizeGrokCliLegacyShellTools(body);
  const validNames = new Set();
  flattenGrokCliNamespaces(body);
  const hostedTypes = new Set(
    body.tools
      .filter((tool: any) => HOSTED_TOOL_TYPES.has(tool?.type))
      .map((tool: any) => tool.type),
  );
  body.tools = body.tools.filter((tool: any) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const type = typeof tool.type === "string" ? tool.type : "";
    const isApplyPatch = type === "apply_patch";

    if (type !== "function") {
      // Hosted tools: { type: "web_search" } / { type: "x_search" }
      if (HOSTED_TOOL_TYPES.has(type)) {
        hostedTypes.add(type);
        return true;
      }
      if (type === "custom" || isApplyPatch) {
        // Custom tools are represented as a constrained function below.
      }
      // Nested function shape without type
      else if (!type && tool.function) {
        // fall through to function flatten below
      } else if (!type || typeof tool.name === "string") {
        // treat as bare function if name present
      } else {
        throw new GrokCliCompatibilityError(`Grok CLI does not support tool type "${type}".`);
      }
    }

    const isFunction =
      type === "function" || type === "custom" || isApplyPatch || type === "" || tool.function || typeof tool.name === "string";
    if (!isFunction || HOSTED_TOOL_TYPES.has(type)) {
      return HOSTED_TOOL_TYPES.has(type);
    }

    const fn =
      tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
        ? tool.function
        : null;
    const rawName =
      isApplyPatch ? "apply_patch" : typeof tool.name === "string" ? tool.name : typeof fn?.name === "string" ? fn.name : "";
    const name = rawName.trim();
    if (!name) return false;
    // The official request builder emits a single native hosted tool when a
    // client function uses the same wire name.
    if (hostedTypes.has(name)) return false;

    const description =
      typeof tool.description === "string"
        ? tool.description
        : typeof fn?.description === "string"
          ? fn.description
          : "";
    const parameters = isApplyPatch
      ? GROK_CLI_APPLY_PATCH_PARAMETERS
      : type === "custom"
      ? GROK_CLI_FREEFORM_TOOL_PARAMETERS
      : tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
        ? tool.parameters
        : fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
          ? fn.parameters
          : { type: "object", properties: {} };
    const strict = isApplyPatch
      ? true
      : typeof tool.strict === "boolean"
      ? tool.strict
      : typeof fn?.strict === "boolean"
        ? fn.strict
        : undefined;

    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, 128);
    if (description) tool.description = description;
    tool.parameters = parameters;
    if (strict !== undefined) tool.strict = strict;
    validNames.add(tool.name);
    return true;
  });

  if (body.tools.length === 0) {
    delete body.tools;
    delete body.tool_choice;
    return;
  }

  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    const choiceType = typeof body.tool_choice.type === "string" ? body.tool_choice.type : "";
    if (choiceType === "function" || choiceType === "custom") {
      const rawName = body.tool_choice.name ?? body.tool_choice.function?.name;
      const name = typeof rawName === "string" ? rawName.trim().slice(0, 128) : "";
      if (!name || !validNames.has(name)) delete body.tool_choice;
      else body.tool_choice = { type: "function", name };
    } else if (!hostedTypes.has(choiceType)) {
      delete body.tool_choice;
    }
  }
}

function resolveEffortFromModel(modelId: any) {
  if (!modelId || typeof modelId !== "string") return null;
  for (const level of EFFORT_LEVELS) {
    if (modelId.endsWith(`-${level}`)) return level;
  }
  return null;
}

/**
 * Grok CLI Executor — OpenAI Responses API on cli-chat-proxy.grok.com
 * Auth: OAuth device-code access token (xai-grok-cli).
 */
export class GrokCliExecutor extends BaseExecutor {
  _agentId: any;
  _currentModel: any;
  _currentModelConfig: any;
  _currentReqId: any;
  _currentSessionId: any;
  _currentTurnIdx: any;
  _hasStableSession: any;
  _usingXaiFallback: any;
  constructor() {
    super("grok-cli", PROVIDERS["grok-cli"]);
    this._currentSessionId = null;
    this._currentReqId = null;
    this._currentTurnIdx = "";
    this._hasStableSession = false;
    this._agentId = null;
    this._usingXaiFallback = false;
  }

  buildUrl() {
    return this._usingXaiFallback ? `${GROK_CLI_XAI_BASE_URL}/responses` : this.config.baseUrl;
  }

  async refreshCredentials(credentials: any, log: any, proxyOptions: any = null) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("grok-cli", credentials, log, proxyOptions);
  }

  needsRefresh(credentials: any) {
    return shouldRefreshCredentials("grok-cli", credentials);
  }

  buildHeaders(credentials: any, stream = true) {
    const headers = super.buildHeaders(credentials, stream);

    // Static fingerprint from registry
    const staticHeaders = this.config.headers || {};
    for (const [k, v] of Object.entries(staticHeaders as Record<string, any>)) {
      if (v != null && headers[k] === undefined) headers[k] = v;
    }

    // Effective upstream plane: cli-chat-proxy (default) or the api.x.ai fallback.
    // Official inject_url_derived_headers gates X-XAI-Token-Auth + x-authenticateresponse
    // on is_cli_chat_proxy_url(base_url) but sends x-grok-client-mode unconditionally.
    const isProxyPlane = isGrokCliProxyUrl(this.buildUrl());

    headers["x-grok-client-identifier"] =
      this.config.clientIdentifier || headers["x-grok-client-identifier"] || GROK_CLI_CLIENT_IDENTIFIER;
    headers["x-grok-client-version"] =
      this.config.clientVersion || headers["x-grok-client-version"] || GROK_CLI_VERSION;
    headers["x-grok-client-mode"] = headers["x-grok-client-mode"] || GROK_CLI_CLIENT_MODE;
    if (isProxyPlane) {
      headers["X-XAI-Token-Auth"] = headers["X-XAI-Token-Auth"] || GROK_CLI_TOKEN_AUTH;
      headers["x-authenticateresponse"] =
        headers["x-authenticateresponse"] || GROK_CLI_AUTHENTICATE_RESPONSE;
    } else {
      // api.x.ai fallback is not a cli-chat-proxy base: drop the proxy-only auth
      // headers that super.buildHeaders seeded from the registry static set.
      delete headers["X-XAI-Token-Auth"];
      delete headers["x-authenticateresponse"];
    }
    headers["User-Agent"] = GROK_CLI_USER_AGENT;
    if (stream) headers["Accept-Encoding"] = "identity";

    const sessionId = this._currentSessionId || credentials?.connectionId || crypto.randomUUID();
    const reqId = this._currentReqId || crypto.randomUUID();
    headers["x-grok-session-id"] = sessionId;
    // CLI uses the same id for conv + session on chat turns
    headers["x-grok-conv-id"] = sessionId;
    headers["x-grok-req-id"] = reqId;
    if (this._hasStableSession && this._currentTurnIdx) headers["x-grok-turn-idx"] = this._currentTurnIdx;

    if (this._agentId) headers["x-grok-agent-id"] = this._agentId;

    // Surface model override (CLI always sets this)
    if (this._currentModel) headers["x-grok-model-override"] = this._currentModel;

    const modelConfig = this._currentModelConfig;
    if (modelConfig?.compactionAtTokens && modelConfig.contextLength && modelConfig.autoCompactThresholdPercent) {
      headers["x-compaction-at"] = String(
        Math.floor(modelConfig.contextLength * modelConfig.autoCompactThresholdPercent / 100),
      );
    }
    if (Number.isInteger(modelConfig?.compactionsRemaining) && modelConfig.compactionsRemaining >= 0) {
      headers["x-compactions-remaining"] = String(modelConfig.compactionsRemaining);
    }

    // Identity: the official inference path (xai-grok-sampler) sends x-grok-user-id
    // from SamplerConfig.user_id. x-email / x-userid belong to the management,
    // remote, and billing clients only — they are not part of the /responses
    // request. x-grok-client-os does not exist upstream (os/arch ride in User-Agent).
    const psd = credentials?.providerSpecificData || {};
    const userId = psd.userId || credentials?.userId || credentials?.providerUserId;
    if (userId) headers["x-grok-user-id"] = String(userId);

    const traceId = crypto.randomBytes(16).toString("hex");
    const spanId = crypto.randomBytes(8).toString("hex");
    headers["traceparent"] = `00-${traceId}-${spanId}-01`;

    return headers;
  }

  parseError(response: any, bodyText: any) {
    // 402 personal-team-blocked:spending-limit → surface as payment/quota for fallback
    if (response.status === 402 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const code = json?.code || "";
        const msg = json?.error || json?.message || bodyText;
        return {
          status: 402,
          message: `${code ? `${code}: ` : ""}${typeof msg === "string" ? msg : bodyText}`,
          code: typeof code === "string" ? code : undefined,
        };
      } catch {
        /* fall through */
      }
    }
    return super.parseError(response, bodyText);
  }

  async transformRequest(model: any, body: any, stream: any, credentials: any) {
    // Session / request ids for headers — stable per client conversation when possible
    this._currentSessionId = resolveGrokCliSessionId(credentials, body);
    this._hasStableSession = Boolean(
      body?.prompt_cache_key || body?.session_id || body?.conversation_id ||
      credentials?.rawHeaders?.["x-grok-session-id"] || credentials?.rawHeaders?.["x-session-id"],
    );
    this._currentReqId = crypto.randomUUID();
    this._agentId =
      credentials?.providerSpecificData?.deviceId ||
      credentials?.providerSpecificData?.agentId ||
      null;
    if (this._hasStableSession && !body.prompt_cache_key && this._currentSessionId) {
      body.prompt_cache_key = this._currentSessionId;
    }
    const requestedModel = model || body.model;
    const compact = body._compact === true;
    this._currentModelConfig = {
      ...getGrokCliModelInfo(requestedModel),
      ...(getCachedGrokCliModelInfo(credentials?.connectionId || credentials?.id, requestedModel) || {}),
    };

    // Normalize Responses input
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;

    // Chat Completions clients arrive with messages[] — translator should have
    // converted already, but guard empty input.
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      if (Array.isArray(body.messages) && body.messages.length > 0) {
        // Soft fallback: map messages → input messages (string content only)
        body.input = body.messages.map((m: any) => ({
          type: "message",
          role: m.role || "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
        }));
        delete body.messages;
      } else {
        body.input = [{ type: "message", role: "user", content: "..." }];
      }
    }

    // Keep role:"system" as-is — official grok-pager HAR sends system, not developer
    // (Codex converts system→developer; Grok CLI does not).
    normalizeGrokCliInput(body);
    stripStoredItemReferences(body);
    normalizeGrokCliTools(body);

    if (compact) {
      body = prepareGrokCliCompaction(body, body.prompt_cache_key || this._currentSessionId);
    }

    // Turn index after input is finalized (user-message count, monotonic per session)
    const incomingTurn = credentials?.rawHeaders?.["x-grok-turn-idx"] || credentials?.rawHeaders?.["X-Grok-Turn-Idx"];
    this._currentTurnIdx = resolveGrokCliTurnIdx(this._currentSessionId, body.input, incomingTurn);

    body.stream = true;
    // Preserve explicit storage for Responses clients. Grok Build's safe default
    // is false, but stored responses are required for previous_response_id turns.
    body.store = body.store === true;

    // Resolve upstream model id (strip effort suffix virtual models)
    let modelEffort = resolveEffortFromModel(requestedModel);
    let resolvedModel = body.model || requestedModel;
    if (modelEffort && resolvedModel.endsWith(`-${modelEffort}`)) {
      resolvedModel = resolvedModel.replace(new RegExp(`-${modelEffort}$`), "");
    }
    resolvedModel = getModelUpstreamId("gcli", resolvedModel) || resolvedModel;
    // Also try provider id key
    if (resolvedModel === (body.model || model)) {
      resolvedModel = getModelUpstreamId("grok-cli", resolvedModel) || resolvedModel;
    }
    body.model = resolvedModel;
    this._currentModel = resolvedModel;

    // Reasoning effort priority: explicit > reasoning_effort > model suffix.
    // grok-build and Composer reject reasoningEffort but still accept summary/encrypted continuity.
    const supportsReasoningEffort = supportsGrokCliReasoningEffort(resolvedModel, this._currentModelConfig);
    const requestedEffort = body.reasoning?.effort || body.reasoning_effort || modelEffort;
    if (!body.reasoning || typeof body.reasoning !== "object") {
      body.reasoning = { summary: "concise" };
      if (supportsReasoningEffort && requestedEffort) {
        body.reasoning.effort = normalizeGrokCliEffort(requestedEffort === "xhigh" || requestedEffort === "max" ? "high" : requestedEffort);
      }
    } else {
      if (supportsReasoningEffort && requestedEffort) {
        body.reasoning.effort = normalizeGrokCliEffort(requestedEffort === "xhigh" || requestedEffort === "max" ? "high" : requestedEffort);
      } else {
        delete body.reasoning.effort;
      }
      if (!body.reasoning.summary) body.reasoning.summary = "concise";
    }
    delete body.reasoning_effort;

    // Encrypted reasoning for multi-turn continuity (CLI always requests this)
    if (body.reasoning && body.reasoning.effort !== "none") {
      const include = Array.isArray(body.include) ? body.include : [];
      if (!include.includes("reasoning.encrypted_content")) {
        include.push("reasoning.encrypted_content");
      }
      body.include = include;
    }

    // Drop Chat Completions leftovers that Responses rejects
    if (body.max_output_tokens === undefined) {
      const maxTokens = body.max_completion_tokens ?? body.max_tokens;
      if (maxTokens !== undefined) body.max_output_tokens = maxTokens;
    }
    delete body.messages;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.n;
    delete body.seed;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logit_bias;
    delete body.user;
    delete body.stream_options;
    delete body.prompt_cache_retention;
    delete body.safety_identifier;
    if (!body.store) delete body.previous_response_id;

    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    // Reasoning replay (server-side continuity): re-inject the previous turn's cached
    // reasoning/tool-call/assistant items into body.input so upstream Grok Build keeps
    // multi-turn sessions coherent even when the client (e.g. Claude Code) drops the
    // encrypted_content blob. Skipped automatically when previous_response_id is present
    // (server holds state) or when no scope is derivable. Fail-open: never blocks a request.
    // The seed mirrors the stream-side capture (stream.js flush) so Apply and Capture
    // resolve the SAME scoped key: prompt_cache_key if the client sent one, else connectionId.
    const replayConnId = credentials?.connectionId || credentials?.id;
    const replaySessionKey = scopedReplayKey({
      seed: body.prompt_cache_key || replayConnId,
      connectionId: replayConnId,
      plane: this._usingXaiFallback ? "xai" : "build",
    });
    if (replaySessionKey && this._currentModel) {
      try {
        body = await getReasoningReplay().Apply({
          model: this._currentModel,
          sessionKey: replaySessionKey,
          body,
        });
      } catch {
        /* fail-open: leave body untouched */
      }
    }

    Object.defineProperty(body, "_grokCliPlane", {
      value: this._usingXaiFallback ? "xai" : "build",
      enumerable: false,
      configurable: true,
    });

    return body;
  }

  // Recovery hook: if upstream 400s on a reasoning-decode failure, strip the opaque
  // encrypted_content blob and retry once. If that persists, clear session identity
  // (prompt_cache_key) and retry stateless. Emit compatibility warnings via console
  // (response header emission deferred until response reconstruction plumbing is ready).
  recoverUpstreamError = async ({ response, url, body, credentials, retry }: any): Promise<any> => {
    const origStatus = response.status;
    if (!response || origStatus !== 400) return null;

    // Read the error text without consuming the original response body.
    let errorText = "";
    try {
      errorText = await response.clone().text();
    } catch {
      return null;
    }
    if (!isReasoningDecodeFailure(errorText)) return null;

    // Derive the replay key exactly like Apply does.
    const replayConnId = credentials?.connectionId || credentials?.id;
    const replaySessionKey = scopedReplayKey({
      seed: body?.prompt_cache_key || replayConnId,
      connectionId: replayConnId,
      plane: this._usingXaiFallback ? "xai" : "build",
    });

    const request = {
      method: "POST",
      model: this._currentModel,
      promptCacheKey: body?.prompt_cache_key,
      previousResponseId: body?.previous_response_id,
    };

    const result = await recoverReasoningDecodeFailure({
      response: { status: origStatus, headers: response.headers, body: errorText, url },
      request,
      body,
      retry,
      onClear: async () => {
        if (replaySessionKey && this._currentModel) {
          try {
            await getReasoningReplay().Clear({ model: this._currentModel, sessionKey: replaySessionKey });
          } catch {}
        }
      },
    });

    // Log outcome (compatibility header to client deferred due to SSE body immutability).
    const o = result.outcome;
    if (o.encryptedContentDowngraded || o.sessionReset || o.failed) {
      console.log("[GrokCLI-Replay-Recovery] model=" + this._currentModel + " downgraded=" + String(o.encryptedContentDowngraded) + " reset=" + String(o.sessionReset) + " failed=" + String(o.failed));
    }

    // Return the raw fetch Response for success/recovered 429 paths; fail-open otherwise.
    if (result.response && result.response.raw && result.response.raw !== response) {
      return { response: result.response.raw, url: result.url || url };
    }
    return null;
  };

  async execute(args: any) {
    // Lazy-resolve stable agent id once per process if connection has none
    if (!this._agentId && !args.credentials?.providerSpecificData?.deviceId) {
      try {
        const mid = await getConsistentMachineId("grok-cli-agent");
        // Format as UUID-ish for header aesthetics
        this._agentId = [
          mid.slice(0, 8),
          mid.slice(8, 12),
          "5" + mid.slice(13, 16),
          "a" + mid.slice(17, 20),
          mid.slice(0, 12).padEnd(12, "0"),
        ].join("-");
      } catch {
        this._agentId = crypto.randomUUID();
      }
    } else if (args.credentials?.providerSpecificData?.deviceId) {
      this._agentId = args.credentials.providerSpecificData.deviceId;
    }

    const quotaTracker = getQuotaTracker();
    const connectionId = args.credentials?.connectionId || args.credentials?.id;
    const quotaMode: QuotaModeValue = QuotaMode.Weekly;

    if (quotaTracker && connectionId) {
      if (quotaTracker.isRateLimited(connectionId)) {
        const snapshot = quotaTracker.getSnapshot(connectionId);
        const resetAt = snapshot.rateLimitResetAt;
        const retryAfter = resetAt ? Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000)) : 60;
        const error = new Error(`Rate limited by upstream. Retry after ${retryAfter}s.`);
        (error as any).status = 429;
        (error as any).headers = { "retry-after": String(retryAfter) };
        throw error;
      }
    }

    const result = await super.execute(args);
    const status = result.response.status;

    // Model catalog ETag tracking
    const modelsEtag = result.response.headers.get("x-models-etag");
    if (modelsEtag && connectionId) {
      const storedEtag = args.credentials?.providerSpecificData?.modelsEtag;
      if (storedEtag && storedEtag !== modelsEtag) {
        args.log?.debug?.("MODEL_CATALOG", `Catalog changed: ${storedEtag} → ${modelsEtag}`);
      }
      // Store the new ETag for next comparison
      if (args.credentials?.providerSpecificData) {
        args.credentials.providerSpecificData.modelsEtag = modelsEtag;
      }
    }

    // Gzip response decompression
    const contentEncoding = result.response.headers.get("content-encoding");
    if (contentEncoding?.toLowerCase() === "gzip") {
      try {
        const decompressed = await decompressGzip(result.response);
        result.response = decompressed;
      } catch (err) {
        args.log?.warn?.("GZIP_DECOMPRESS", `Failed to decompress gzip response: ${err}`);
      }
    }

    // Semantic stream idle timeout for streaming responses
    const isStreaming = result.response.headers.get("content-type")?.includes("text/event-stream");
    if (isStreaming && result.response.body) {
      const idleTimeout = 60_000; // 60 seconds
      result.response = wrapWithSemanticIdle(result.response, idleTimeout);
    }

    if (status === 429 || status === 402) {
      const bodyText = await result.response.clone().text().catch(() => "");
      const metadata = parseRateLimitMetadata(bodyText);
      const rateLimitHeaders = buildRateLimitResponseHeaders(metadata, result.response.headers);
      for (const [key, value] of Object.entries(rateLimitHeaders)) {
        result.response.headers.set(key, value);
      }
      if (quotaTracker && connectionId) {
        const isFamilyExhaustion = isGrokCliFreeUsageExhausted(GROK_CLI_PROVIDER, status, bodyText);
        if (!isFamilyExhaustion && quotaTracker.isQuotaExhaustedError(status, bodyText)) {
          const rateLimitInfo = quotaTracker.parseRateLimitFromResponse(
            status,
            result.response.headers,
            bodyText,
          );
          quotaTracker.recordRateLimit(connectionId, quotaMode, rateLimitInfo);
        }
      }
    } else if (status >= 200 && status < 300) {
      if (quotaTracker && connectionId) {
        quotaTracker.decrementQuota(connectionId, quotaMode, 1);
      }
    }

    if (this._usingXaiFallback || !shouldUseGrokCliXaiFallback(
      args.credentials,
      result.response.status,
      await result.response.clone().text().catch(() => ""),
    )) {
      return result;
    }

    args.log?.debug?.("FALLBACK", "Grok Build 403; retrying eligible SuperGrok request through api.x.ai");
    this._usingXaiFallback = true;
    try {
      return await super.execute(args);
    } finally {
      this._usingXaiFallback = false;
    }
  }
}

export default GrokCliExecutor;
