import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../../providers/config/providers.ts";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import { openaiToGeminiRequest } from "../translator/request/openai-to-gemini.js";
import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { canonicalSessionID } from "./opencodeIdentity.js";

// OpenCode Console exposes four endpoint families keyed by model family (see
// https://opencode.ai/docs/zen):
//   - Responses family (GPT, Grok, Muse Spark)  -> /inference/openai/v1/responses
//   - Messages family  (Claude, Qwen)           -> /inference/anthropic/v1/messages
//   - Gemini family    (Gemini)                 -> /inference/google/v1beta/models/:id
//   - Chat family      (DeepSeek, MiniMax, GLM, Kimi, free) -> /inference/openai/v1/chat/completions
//
// Free-tier gate (since 2026-09-16, tightened 2026-10-14):
// The "*-free" models are gated behind a request-shape check. The upstream
// rejects anonymous requests that do not look like an official OpenCode agent
// session with 403 FreeTierError. To pass the gate the request must:
//
//   1. Carry a canonical session id in x-opencode-session / x-opencode-session-id
//      minted by Identifier.descending(): "ses_" + 12 hex (inverted 48-bit ts
//      with counter 1, low 12 hex digits = ffe) + 14 Base62 chars. See
//      opencodeIdentity.ts.
//   2. Send x-opencode-project: "global" (bare literal, not prj_*).
//   3. Send User-Agent: "opencode/<channel>/<version>/cli".
//   4. Send x-opencode-client: "cli".
//   5. NOT send x-opencode-request (the /inference gate rejects it).
//   6. Force stream: true with stream_options.include_usage: true.
//   7. Include the core agent toolset — shell, edit, glob, grep, read — with
//      the genuine CLI definitions (description + parameter schema) embedded
//      byte-for-byte. The gate compares recognised tool definitions against
//      the official client's; stub definitions are rejected.
//   8. Authenticate with "Bearer public".
//
// Paid models (no "-free" suffix) skip the gate entirely and authenticate
// with a real OPENCODE_API_KEY from https://opencode.ai/auth.

const MESSAGES_PREFIXES = ["claude-", "qwen"];
const RESPONSES_PREFIXES = ["gpt-", "grok-", "muse-spark"];
const GEMINI_PREFIX = "gemini-";

const OPENCODE_USER_AGENT = "opencode/latest/2.0.29/cli";

// Core agent tools the /inference free-tier gate expects, with genuine CLI
// definitions captured from the official client. Loaded from the embedded JSON.
const TOOL_DEFINITIONS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "opencode_tools.json",
);
const OPENCODE_TOOLS: Record<string, { description: string; parameters: Record<string, unknown> }> = (() => {
  try {
    return JSON.parse(readFileSync(TOOL_DEFINITIONS_PATH, "utf-8"));
  } catch {
    return {};
  }
})();

const FREE_TIER_CORE_TOOLS = ["shell", "edit", "glob", "grep", "read"];

function familyOf(model: any): "responses" | "claude" | "gemini" | "openai" {
  const id = String(model || "").toLowerCase();
  if (id.startsWith(GEMINI_PREFIX)) return "gemini";
  if (MESSAGES_PREFIXES.some((p) => id.startsWith(p))) return "claude";
  if (RESPONSES_PREFIXES.some((p) => id.startsWith(p))) return "responses";
  return "openai";
}

function isFreeModel(model: any): boolean {
  return String(model || "").toLowerCase().endsWith("-free") || String(model || "").toLowerCase() === "big-pickle";
}

/**
 * Injects the core agent toolset into a Chat/Responses request body so the
 * free-tier gate recognises it as an official OpenCode agent session. Each
 * tool carries the genuine CLI description and parameter schema; the gate
 * compares these byte-for-byte and rejects stubs. Extra client-declared tools
 * are preserved.
 */
function injectFreeTierTools(body: any): any {
  if (!body || typeof body !== "object") return body;
  const existingTools: any[] = Array.isArray(body.tools) ? body.tools : [];
  const existingNames = new Set(
    existingTools
      .map((t) => t?.function?.name || t?.name || "")
      .filter(Boolean),
  );
  const coreTools = FREE_TIER_CORE_TOOLS
    .filter((name) => !existingNames.has(name) && OPENCODE_TOOLS[name])
    .map((name) => ({
      type: "function",
      function: {
        name,
        description: OPENCODE_TOOLS[name].description,
        parameters: OPENCODE_TOOLS[name].parameters,
      },
    }));
  // For any existing tool whose name matches a core tool, replace its
  // definition with the genuine one so the gate's byte comparison passes.
  const patchedExisting = existingTools.map((t) => {
    const name = t?.function?.name || t?.name || "";
    if (FREE_TIER_CORE_TOOLS.includes(name) && OPENCODE_TOOLS[name]) {
      return {
        ...t,
        function: {
          ...t?.function,
          name,
          description: OPENCODE_TOOLS[name].description,
          parameters: OPENCODE_TOOLS[name].parameters,
        },
      };
    }
    return t;
  });
  return { ...body, tools: [...patchedExisting, ...coreTools] };
}

/**
 * Prepares a request body for the free-tier gate: forces streaming and
 * injects the core agent tools. Paid-model bodies pass through unchanged
 * except for the stream/include_usage forcing when the caller requested
 * non-streaming output (the gate still requires SSE upstream).
 */
function prepareFreeTierBody(body: any): any {
  if (!body || typeof body !== "object") return body;
  const next = { ...body };
  if (next.stream !== true) {
    next.stream = true;
  }
  if (!next.stream_options || typeof next.stream_options !== "object") {
    next.stream_options = {};
  }
  if (!next.stream_options.include_usage) {
    next.stream_options = { ...next.stream_options, include_usage: true };
  }
  return injectFreeTierTools(next);
}

export class OpenCodeExecutor extends BaseExecutor {
  _sessionCache: Map<string, string> = new Map();

  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model: any, body: any) {
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model: any) {
    const base = this.config.baseUrl;
    const family = familyOf(model);
    if (family === "gemini") return `${base}/inference/google/v1beta/models/${model}`;
    if (family === "claude") return `${base}/inference/anthropic/v1/messages`;
    if (family === "responses") return `${base}/inference/openai/v1/responses`;
    return `${base}/inference/openai/v1/chat/completions`;
  }

  buildHeaders(credentials: any, stream = true) {
    const hasKey = Boolean(credentials?.apiKey && credentials.apiKey !== "public");
    const key = hasKey ? credentials!.apiKey : "public";
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "Accept": stream ? "application/json, text/event-stream" : "application/json",
    };
  }

  /**
   * Builds the full header set the free-tier gate inspects. Paid-model
   * requests send a simpler set.
   */
  buildFreeTierHeaders(sessionId: string, _credentials: any, stream = true) {
    return {
      "Content-Type": "application/json",
      "Accept": stream ? "application/json, text/event-stream" : "application/json",
      "Authorization": "Bearer public",
      "x-opencode-client": "cli",
      "x-opencode-session": sessionId,
      "x-opencode-session-id": sessionId,
      "x-session-affinity": sessionId,
      "X-Session-Id": sessionId,
      "x-opencode-project": "global",
      "User-Agent": OPENCODE_USER_AGENT,
    };
  }

  resolveSessionId(model: any, body: any): string {
    const seed = body?.metadata?.session_id ||
      body?.conversation_id ||
      `opencode:${model}:${Date.now()}`;
    if (!this._sessionCache.has(seed)) {
      this._sessionCache.set(seed, canonicalSessionID(String(seed)));
    }
    return this._sessionCache.get(seed)!;
  }

  async execute(options: any): Promise<any> {
    const { model, body, credentials } = options;
    const family = familyOf(model);
    const free = isFreeModel(model);

    // For free models, inject tools + force stream + use canonical headers.
    if (free) {
      const sessionId = this.resolveSessionId(model, body);
      const preparedBody = prepareFreeTierBody(body);
      const freeOptions = {
        ...options,
        body: preparedBody,
        credentials: { ...credentials, apiKey: "public" },
      };

      if (family === "openai") {
        return this.executeFreeChat(freeOptions, sessionId);
      }
      if (family === "responses") {
        return this.executeFreeResponses(freeOptions, sessionId);
      }
      if (family === "claude") {
        return this.executeFreeMessages(freeOptions, sessionId);
      }
      return this.executeFreeGemini(freeOptions, sessionId);
    }

    // Paid models: use the stored API key, no free-tier shaping needed.
    if (family === "openai") {
      return super.execute(options);
    }
    if (family === "responses") {
      return this.executeResponses(options);
    }
    if (family === "claude") {
      return this.executeMessages(options);
    }
    return this.executeGemini(options);
  }

  async executeFreeChat(options: any, sessionId: string) {
    const { model, body, stream, signal, proxyOptions = null } = options;
    const url = this.buildUrl(model);
    const headers = this.buildFreeTierHeaders(sessionId, null, stream);
    const transformedBody = this.transformRequest(model, body);
    const response = await this.fetch(url, headers, transformedBody, signal, proxyOptions);
    return { response, url, headers, transformedBody, responseFormat: "openai" };
  }

  async executeFreeResponses(options: any, sessionId: string) {
    const { model, body, stream, credentials, signal, proxyOptions = null } = options;
    const url = this.buildUrl(model);
    const headers = this.buildFreeTierHeaders(sessionId, null, stream);
    const transformedBody = openaiToOpenAIResponsesRequest(model, body, stream, credentials);
    const response = await this.fetch(url, headers, transformedBody, signal, proxyOptions);
    return { response, url, headers, transformedBody, responseFormat: "openai-responses" };
  }

  async executeFreeMessages(options: any, sessionId: string) {
    const { model, body, stream, signal, proxyOptions = null } = options;
    const url = this.buildUrl(model);
    const headers = this.buildFreeTierHeaders(sessionId, null, stream);
    const transformedBody = openaiToClaudeRequest(model, body, stream);
    const response = await this.fetch(url, headers, transformedBody, signal, proxyOptions);
    return { response, url, headers, transformedBody, responseFormat: "claude" };
  }

  async executeFreeGemini(options: any, sessionId: string) {
    const { model, body, stream, credentials, signal, proxyOptions = null } = options;
    const url = this.buildUrl(model);
    const headers = this.buildFreeTierHeaders(sessionId, null, stream);
    const transformedBody = openaiToGeminiRequest(model, body, stream, credentials);
    const response = await this.fetch(url, headers, transformedBody, signal, proxyOptions);
    return { response, url, headers, transformedBody, responseFormat: "gemini" };
  }

  async executeResponses({ model, body, stream, credentials, signal, log, proxyOptions = null }: any) {
    const url = this.buildUrl(model);
    const headers = this.buildHeaders(credentials, stream);
    const transformedBody = openaiToOpenAIResponsesRequest(model, body, stream, credentials);
    const response = await this.fetch(url, headers, transformedBody, signal, proxyOptions);
    return { response, url, headers, transformedBody, responseFormat: "openai-responses" };
  }

  async executeMessages({ model, body, stream, credentials, signal, log, proxyOptions = null }: any) {
    const url = this.buildUrl(model);
    const headers = this.buildHeaders(credentials, stream);
    const transformedBody = openaiToClaudeRequest(model, body, stream);
    const response = await this.fetch(url, headers, transformedBody, signal, proxyOptions);
    return { response, url, headers, transformedBody, responseFormat: "claude" };
  }

  async executeGemini({ model, body, stream, credentials, signal, log, proxyOptions = null }: any) {
    const url = this.buildUrl(model);
    const headers = this.buildHeaders(credentials, stream);
    const transformedBody = openaiToGeminiRequest(model, body, stream, credentials);
    const response = await this.fetch(url, headers, transformedBody, signal, proxyOptions);
    return { response, url, headers, transformedBody, responseFormat: "gemini" };
  }

  async fetch(url: any, headers: any, body: any, signal: any, proxyOptions: any) {
    return proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    }, proxyOptions);
  }
}
