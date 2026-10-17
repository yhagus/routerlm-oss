import { randomUUID } from "node:crypto";
import { DefaultExecutor } from "./default.js";
import { dbgAlways } from "../utils/debugLog.js";

/**
 * CodeBuddyIntlCliExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same endpoint as codebuddy-intl, but identifies as the CLI platform instead
 * of the IDE. Auth is OAuth (device-code), stored in lobakai credentials.
 *
 * Ported from codebuddy-intl executor with CLI platform headers:
 *   - X-IDE-Type: CLI, X-IDE-Name: CLI, X-IDE-Version: CLI_VERSION
 *   - CLI_USER_AGENT with CLI version string
 *   - OAuth bearer token (same device-code flow as codebuddy-intl)
 */

const CLI_VERSION = "2.154.0";
const CLI_USER_AGENT = `CLI/${CLI_VERSION} CodeBuddy/${CLI_VERSION}`;
const CODEBUDDY_ORIGIN = "https://www.codebuddy.ai";
const SYSTEM_PLACEHOLDER = "You are a helpful assistant.";

// CodeBuddy error codes (see services/providers/oauth/providers/codebuddy-intl.ts).
const SESSION_DEAD_CODE = 12153;
const SESSION_DEAD_TEXT = "offline user session not found";
const MISSING_SYSTEM_CODE = 11128;
const MISSING_SYSTEM_TEXT = "first message is not system prompt";
const RATE_LIMIT_CODE = 6004;
const TOO_MANY_REQUESTS_CODE = 14003;
const PROVIDER_UNAVAILABLE_CODE = 11134;
const MODEL_UNAVAILABLE_CODE = 11102;
const NON_STREAM_UNSUPPORTED_CODE = 11101;
const EMPTY_CONTENT_CODE = 11151;
// The absolute reset in a CodeBuddy usage-limit message is wall-clock UTC+8.
const QUOTA_RESET_PATTERN = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;
const QUOTA_RESET_OFFSET_MS = 8 * 60 * 60 * 1000;

// Our own canonical error messages. CodeBuddy's raw `msg` text is used only to
// classify the failure (and to read the quota reset timestamp) — it is never
// surfaced as the error we emit.
const ERR = {
  sessionDead: "CodeBuddy CLI session expired; re-login required",
  quota: "CodeBuddy CLI quota exhausted",
  rateLimited: "CodeBuddy CLI rate limit reached",
  unavailable: "CodeBuddy CLI is temporarily unavailable",
  modelUnavailable: "CodeBuddy CLI model is not available",
  nonStream: "CodeBuddy CLI only supports streaming responses",
  invalidRequest: "CodeBuddy CLI rejected the request",
  notFound: "CodeBuddy CLI endpoint or model not found",
} as const;

// ---- message shaping (cli2api PrepareBody) --------------------------------

function normalizeToolChoice(body: any) {
  const raw = body.tool_choice;
  if (raw === undefined) return;
  if (typeof raw === "string") {
    if (raw === "none") {
      delete body.tool_choice;
      delete body.tools;
      delete body.functions;
    }
    return;
  }
  if (raw && typeof raw === "object") {
    const kind = raw.type;
    if (kind === "none") {
      delete body.tool_choice;
      delete body.tools;
      delete body.functions;
    } else if (kind === "auto" || kind === "required") {
      body.tool_choice = kind;
    } else if (kind === "function") {
      const name = raw.function?.name || raw.name || "";
      body.tool_choice = name || "auto";
    } else {
      delete body.tool_choice;
    }
    return;
  }
  delete body.tool_choice;
}

function dropEmptyTools(body: any) {
  if (!("tools" in body)) return;
  const raw = body.tools;
  if (raw == null) {
    delete body.tools;
    return;
  }
  if (Array.isArray(raw) && raw.length === 0) {
    delete body.tools;
    delete body.tool_choice;
  }
}

function hasToolCalls(message: any) {
  const raw = message?.tool_calls;
  if (raw == null) return false;
  return Array.isArray(raw) ? raw.length > 0 : true;
}

function normalizeEmptyMessageContent(body: any) {
  if (!Array.isArray(body.messages)) return;
  body.messages = body.messages.filter((message: any) => {
    if (!message || typeof message !== "object") return true;
    const content = message.content;
    let empty = content === undefined || content === null;
    if (typeof content === "string") empty = content.trim() === "";
    if (Array.isArray(content)) empty = content.length === 0;
    return !(empty && !hasToolCalls(message));
  });
}

// CodeBuddy rejects a request whose first message isn't a system prompt
// (code 11128). Prepend a non-empty placeholder when needed; never discard the
// caller's own system prompt.
function ensureLeadingSystem(body: any) {
  const list = Array.isArray(body.messages) ? body.messages : null;
  if (!list) return;
  if (list.length === 0) {
    body.messages = [{ role: "system", content: SYSTEM_PLACEHOLDER }];
    return;
  }
  const first = list[0];
  const role = first && typeof first === "object" ? String(first.role || "").trim().toLowerCase() : "";
  if (role === "system") return;
  body.messages = [{ role: "system", content: SYSTEM_PLACEHOLDER }, ...list];
}

// ---- body (cli2api fixed key set) ------------------------------------------

function buildWireBody(transformed: any) {
  const body: Record<string, any> = {
    model: transformed.model,
    messages: transformed.messages,
    stream: true,
  };

  // max_completion_tokens is the Responses-style alias → max_tokens.
  const maxTokens = transformed.max_tokens ?? transformed.max_completion_tokens;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (transformed.temperature !== undefined) body.temperature = transformed.temperature;
  if (transformed.tools !== undefined) body.tools = transformed.tools;
  if (transformed.tool_choice !== undefined) body.tool_choice = transformed.tool_choice;

  const effort = transformed.reasoning_effort;
  if (effort !== "none" && effort !== "off") {
    if (effort) {
      body.reasoning_effort = effort;
      body.reasoning_summary = "auto";
    } else if (transformed.reasoning_summary) {
      // Product layer already injected the CLI default — just keep it.
      body.reasoning_summary = transformed.reasoning_summary;
    }
  }

  return body;
}

// ---- SSE sanitize (cli2api rewriteChatStream / sanitizeSSEPayload) ---------

function dropEmptyString(delta: any, key: string) {
  if (typeof delta[key] === "string" && delta[key] === "") delete delta[key];
}

function sanitizeDelta(delta: any) {
  dropEmptyString(delta, "content");
  dropEmptyString(delta, "reasoning_content");
  dropEmptyString(delta, "refusal");
  if ("extra_fields" in delta && delta.extra_fields == null) delete delta.extra_fields;
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length === 0) delete delta.tool_calls;
  if (delta.tool_calls == null) delete delta.tool_calls;
  const fc = delta.function_call;
  if (fc == null) {
    delete delta.function_call;
  } else if (typeof fc === "object" && !fc.name && !fc.arguments) {
    delete delta.function_call;
  }
}

// Returns the sanitized payload string, or null when the chunk should be dropped.
function sanitizePayload(payload: string, state: { sentRole: boolean }): string | null {
  if (payload === "[DONE]") return payload;
  let chunk: any;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return payload;
  }
  if (!chunk || typeof chunk !== "object") return payload;

  let keep = chunk.usage != null;
  if (Array.isArray(chunk.choices)) {
    for (const choice of chunk.choices) {
      if (!choice || typeof choice !== "object") continue;
      const delta = choice.delta;
      if (delta && typeof delta === "object") {
        sanitizeDelta(delta);
        if ("role" in delta && state.sentRole) delete delta.role;
        if (Object.keys(delta).length > 0) {
          keep = true;
          if ("role" in delta) state.sentRole = true;
        }
      }
      if (typeof choice.finish_reason === "string") {
        if (choice.finish_reason === "") delete choice.finish_reason;
        else keep = true;
      } else if ("finish_reason" in choice && choice.finish_reason == null) {
        delete choice.finish_reason;
      }
    }
  }
  if (!keep) return null;
  try {
    return JSON.stringify(chunk);
  } catch {
    return payload;
  }
}

export function sanitizeSSEStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = { sentRole: false };
  let buffer = "";

  const emit = (controller: TransformStreamDefaultController<Uint8Array>, line: string) => {
    if (line === "") return;
    if (!line.startsWith("data:")) {
      controller.enqueue(encoder.encode(`${line}\n`));
      return;
    }
    const payload = line.slice(5).trim();
    if (payload === "") return;
    const cleaned = sanitizePayload(payload, state);
    if (cleaned != null) controller.enqueue(encoder.encode(`data: ${cleaned}\n\n`));
  };

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) emit(controller, line.replace(/\r$/, ""));
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) emit(controller, buffer.replace(/\r$/, ""));
      },
    })
  );
}

// ---- error taxonomy (cli2api Classify) ------------------------------------

function parseQuotaResetMs(message: string): number | undefined {
  const match = message.match(QUOTA_RESET_PATTERN);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map((n) => Number(n));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  // CodeBuddy's reset timestamp is wall-clock UTC+8; convert to epoch ms.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - QUOTA_RESET_OFFSET_MS;
  return Number.isFinite(utcMs) ? utcMs : undefined;
}

export class CodeBuddyIntlCliExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl-cli");
  }

  transformRequest(model: any, body: any, stream: any, credentials: any) {
    const transformed = super.transformRequest(model, body, stream, credentials);

    normalizeEmptyMessageContent(transformed);
    ensureLeadingSystem(transformed);
    normalizeToolChoice(transformed);
    dropEmptyTools(transformed);

    // CodeBuddy rejects non-stream chat requests (code 11101); lobakai still
    // re-aggregates the SSE for non-streaming clients. buildWireBody forces it.
    return buildWireBody(transformed);
  }

  buildHeaders(credentials: any, stream = true) {
    const headers: Record<string, any> = super.buildHeaders(credentials, stream);
    const psd = credentials?.providerSpecificData && typeof credentials.providerSpecificData === "object" ? credentials.providerSpecificData : {};

    // Identity — CodeBuddy reads the account identity from dedicated headers.
    const uid = credentials?.codebuddyUserId || psd.codebuddyUserId;
    const enterpriseId = credentials?.codebuddyEnterpriseId || psd.codebuddyEnterpriseId;
    const domain = credentials?.codebuddyDomain || psd.codebuddyDomain;
    if (uid) headers["X-User-Id"] = String(uid);
    else headers["X-No-User-Id"] = "1";
    if (enterpriseId) headers["X-Enterprise-Id"] = String(enterpriseId);
    else headers["X-No-Enterprise-Id"] = "1";
    if (domain) headers["X-Domain"] = String(domain);
    else headers["X-No-Department-Info"] = "1";
    headers["X-Product"] = "SaaS";

    // CLI channel identity (CodeBuddy CLI 2.154.0).
    headers["User-Agent"] = CLI_USER_AGENT;
    headers["Origin"] = CODEBUDDY_ORIGIN;
    const sessionId = randomUUID().replace(/-/g, "");
    const conversationRequestId = randomUUID().replace(/-/g, "");
    const messageId = randomUUID().replace(/-/g, "");
    headers["X-Request-ID"] = messageId;
    headers["X-Conversation-ID"] = sessionId;
    headers["X-Session-ID"] = sessionId;
    headers["X-Conversation-Request-ID"] = conversationRequestId;
    headers["X-Conversation-Message-ID"] = messageId;
    headers["X-Agent-Type"] = "main";
    headers["X-Agent-Intent"] = "craft";
    headers["X-IDE-Type"] = "CLI";
    headers["X-IDE-Name"] = "CLI";
    headers["X-IDE-Version"] = CLI_VERSION;
    headers["X-Private-Data"] = "false";
    delete headers["x-codebuddy-request"];

    // cli2api sends this Accept on the chat path (not text/event-stream).
    headers["Accept"] = "application/json, text/plain, */*";
    return headers;
  }

  async execute(options: any): Promise<any> {
    const result = await super.execute(options);
    const response = result?.response;
    const contentType = response?.headers?.get?.("content-type") || "";
    if (response?.ok && response.body && contentType.includes("text/event-stream")) {
      const sanitized = sanitizeSSEStream(response.body);
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      result.response = new Response(sanitized, { status: response.status, statusText: response.statusText, headers });
    }
    return result;
  }

  parseError(response: any, bodyText: any) {
    const status = response?.status ?? 502;
    const text = String(bodyText || "");
    const lower = text.toLowerCase();

    // Read the provider code/msg for classification only — never emit the raw msg.
    let code: number | null = null;
    let rawMessage = text;
    try {
      const json = JSON.parse(text);
      if (json && typeof json === "object") {
        if (typeof json.code === "number") code = json.code;
        if (typeof json.msg === "string") rawMessage = json.msg;
        else if (typeof json.message === "string") rawMessage = json.message;
      }
    } catch {
      /* non-JSON body (HTML error page, etc.) */
    }
    const codeStr = code != null ? String(code) : undefined;

    // Surface the raw upstream error body in debug logs so 400 rejections can
    // be diagnosed (canonical messages below intentionally hide provider text).
    dbgAlways("CODEBUDDY-CLI", `parseError status=${status} code=${codeStr ?? "n/a"} raw=${text.slice(0, 500)}`);

    if (status === 401 || code === SESSION_DEAD_CODE || lower.includes(SESSION_DEAD_TEXT)) {
      return { status: 401, message: ERR.sessionDead, disableAccount: true, code: codeStr };
    }
    if (status === 402 || lower.includes("insufficient credit") || lower.includes("quota exceeded") || rawMessage.includes("积分不足") || rawMessage.includes("余额不足")) {
      return { status: 402, message: ERR.quota, code: codeStr };
    }
    if (status === 429 || code === RATE_LIMIT_CODE || code === TOO_MANY_REQUESTS_CODE || lower.includes("soft_rate")) {
      // Only 6004 carries the absolute UTC+8 reset timestamp.
      const resetsAtMs = code === RATE_LIMIT_CODE ? parseQuotaResetMs(rawMessage) : undefined;
      return { status: 429, message: ERR.rateLimited, resetsAtMs, code: codeStr };
    }
    if (code === PROVIDER_UNAVAILABLE_CODE) {
      return { status: 503, message: ERR.unavailable, code: codeStr };
    }
    if (status >= 500) {
      return { status, message: ERR.unavailable, code: codeStr };
    }
    if (code === MODEL_UNAVAILABLE_CODE) {
      return { status: 400, message: ERR.modelUnavailable, code: codeStr };
    }
    if (code === NON_STREAM_UNSUPPORTED_CODE) {
      return { status: 400, message: ERR.nonStream, code: codeStr };
    }
    if (status === 404) {
      return { status: 404, message: ERR.notFound, code: codeStr };
    }
    if (status === 400 || code === MISSING_SYSTEM_CODE || code === EMPTY_CONTENT_CODE || lower.includes(MISSING_SYSTEM_TEXT)) {
      return { status: status >= 400 ? status : 400, message: ERR.invalidRequest, code: codeStr };
    }
    if (code != null && code !== 0) {
      return { status: status >= 400 ? status : 502, message: ERR.unavailable, code: codeStr };
    }
    return { status: status >= 400 ? status : 502, message: ERR.invalidRequest };
  }
}

export default CodeBuddyIntlCliExecutor;
