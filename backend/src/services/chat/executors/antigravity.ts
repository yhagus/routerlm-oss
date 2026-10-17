import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../../providers/config/providers.ts";
import { OAUTH_ENDPOINTS, ANTIGRAVITY_HEADERS, AG_DEFAULT_TOOLS, AG_TOOL_SUFFIX } from "../../providers/config/appConstants.ts";
import { HTTP_STATUS } from "../../providers/config/runtimeConfig.ts";
import { resolveSessionId, toNumericSessionId } from "../utils/sessionManager.js";
import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { cleanJSONSchemaForAntigravity } from "../translator/formats/gemini.js";
import { DEFAULT_THINKING_AG_SIGNATURE } from "../../providers/config/defaultThinkingSignature.ts";

function sanitizeFunctionName(name: string): string {
  if (!name) return "_unknown";
  let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
  return s.substring(0, 64);
}

const MAX_RETRY_AFTER_MS = 10000;
const ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS = 15000;
const MAX_ANTIGRAVITY_OUTPUT_TOKENS = 64000;
const ANTIGRAVITY_IDE_REQUEST_ID_RE = /^agent\/[^/]+\/\d+\/[^/]+\/\d+$/;

const ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS = [
  /high\s+traffic/i,
  /agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i,
  /capacity/i,
  /temporarily\s+unavailable/i,
  /timeout/i,
  /stream\s+(ended|closed|terminated|interrupted)/i,
  /empty\s+response/i,
];

const ANTIGRAVITY_TRANSIENT_STATUSES = new Set([
  HTTP_STATUS.SERVER_ERROR,
  HTTP_STATUS.BAD_GATEWAY,
  HTTP_STATUS.SERVICE_UNAVAILABLE,
  HTTP_STATUS.GATEWAY_TIMEOUT,
]);

const ANTIGRAVITY_REQUEST_BLACKLIST = [
  "output_config",
  "thinking",
  "reasoning_effort",
  "reasoning",
  "enable_thinking",
  "thinking_budget",
  "thinkingConfig",
];

const stripBlacklisted = (obj: any) => {
  for (const key of ANTIGRAVITY_REQUEST_BLACKLIST) delete obj[key];
};

const IMAGE_MODEL_PATTERNS = [
  /image/i,
  /imagen/i,
  /image-generation/i,
];

function isImageModel(model: string): boolean {
  if (!model) return false;
  return IMAGE_MODEL_PATTERNS.some(p => p.test(model));
}

function parseImageConfig(model: string): { aspectRatio: string } {
  const config = { aspectRatio: "1:1" };
  const resMatch = model.match(/(\d+)x(\d+)$/);
  if (resMatch) {
    const w = parseInt(resMatch[1]);
    const h = parseInt(resMatch[2]);
    if (w <= 16 && h <= 16) {
      config.aspectRatio = `${w}:${h}`;
    } else {
      const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
      const d = gcd(w, h);
      config.aspectRatio = `${w/d}:${h/d}`;
    }
  }
  return config;
}

function uuidFromSeed(seed: string): string {
  const bytes = crypto.createHash("sha256").update(String(seed || "antigravity")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildIdeRequestId({ body, request, credentials, model, requestType }: any): string {
  if (ANTIGRAVITY_IDE_REQUEST_ID_RE.test(body?.requestId || "")) {
    return body.requestId;
  }

  const sessionId = request?.sessionId || body?.request?.sessionId || credentials?._clientSessionId || credentials?.connectionId || credentials?.email || "anonymous";
  const conversationId = uuidFromSeed(`antigravity:conversation:${sessionId}`);
  const trajectoryId = uuidFromSeed(`antigravity:trajectory:${sessionId}:${model}:${requestType}`);
  const contentCount = Array.isArray(request?.contents) ? request.contents.length : 1;
  const step = Math.max(1, contentCount * 2 - 1);
  return `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`;
}

function normalizeGeminiContents(contents: any[]): any[] {
  const out: any[] = [];
  for (const c of contents || []) {
    if (!c?.role || !Array.isArray(c.parts) || c.parts.length === 0) continue;
    const last = out.at(-1);
    if (last?.role === c.role) last.parts.push(...c.parts);
    else out.push({ ...c, parts: [...c.parts] });
  }
  return out;
}

export class AntigravityExecutor extends BaseExecutor {
  _lastSessionId: string | undefined;

  constructor() {
    super("antigravity", PROVIDERS.antigravity);
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    const forceNonStream = isImageModel(model);
    const action = (stream && !forceNonStream) ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  buildHeaders(credentials: any, stream = true, sessionId: string | null = null) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": this.config.headers?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"],
    };
  }

  transformRequest(model: string, body: any, stream: any, credentials: any) {
    const projectId = credentials?.projectId || this.generateProjectId();

    if (stream !== true) delete body.stream_options;

    if (isImageModel(model)) {
      const imageConfig = parseImageConfig(model);
      const cleanModel = model.replace(/-(\d+)x(\d+)$/, "");

      const contents: any[] = [];
      const srcContents = body.request?.contents || body.contents || [];
      for (const c of srcContents) {
        const textParts = (c.parts || []).filter((p: any) => p.text !== undefined).map((p: any) => ({ text: p.text }));
        if (textParts.length > 0) {
          contents.push({ role: c.role || "user", parts: textParts });
        }
      }

      const sessionId = resolveSessionId({
        headers: credentials?.rawHeaders,
        body,
        connectionId: credentials?.email || credentials?.connectionId,
        scope: "antigravity",
      });

      this._lastSessionId = sessionId;
      const request = {
        contents,
        generationConfig: {
          temperature: 1.0,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
          imageConfig,
        },
        sessionId,
      };

      return {
        project: projectId,
        model: cleanModel,
        userAgent: "antigravity",
        requestType: "image_gen",
        requestId: buildIdeRequestId({ body, request, credentials, model: cleanModel, requestType: "image_gen" }),
        request,
      };
    }

    const rawSessionId = body.request?.sessionId || resolveSessionId({ headers: credentials?.rawHeaders, body, connectionId: credentials?.email || credentials?.connectionId, scope: "antigravity" });
    const sessionId = toNumericSessionId(rawSessionId) || rawSessionId;

    const rawContents = (body.request?.contents || []).map((c: any) => {
      let role = c.role;
      if (c.parts?.some((p: any) => p.functionResponse)) {
        role = "user";
      }
      const parts = c.parts?.filter((p: any) => {
        if (p.thought && !p.functionCall) return false;
        if (p.thoughtSignature && !p.functionCall && !p.text) return false;
        return true;
      });

      let firstFunctionCallSeen = false;
      const modifiedParts = parts?.map((p: any) => {
        if (!p.functionCall) return p;
        const callSig = p.thoughtSignature || (!firstFunctionCallSeen ? DEFAULT_THINKING_AG_SIGNATURE : undefined);
        firstFunctionCallSeen = true;
        if (callSig) {
          return { ...p, thoughtSignature: callSig };
        }
        if (p.thoughtSignature) {
          const { thoughtSignature: _, ...rest } = p;
          return rest;
        }
        return p;
      });

      return {
        ...c,
        role,
        parts: modifiedParts || parts || [],
      };
    });
    const contents = normalizeGeminiContents(rawContents);

    let tools = body.request?.tools;

    if (tools && tools.length > 0) {
      const seenToolNames = new Set();
      const allDeclarations: any[] = [];
      for (const group of tools) {
        for (const fn of group.functionDeclarations || []) {
          const name = sanitizeFunctionName(fn.name);
          if (seenToolNames.has(name)) continue;
          seenToolNames.add(name);
          allDeclarations.push({
            ...fn,
            name,
            parameters: fn.parameters
              ? cleanJSONSchemaForAntigravity(structuredClone(fn.parameters))
              : { type: "object", properties: { reason: { type: "string", description: "Brief explanation" } }, required: ["reason"] }
          });
        }
      }
      tools = allDeclarations.length > 0 ? [{ functionDeclarations: allDeclarations }] : [];
    }

    const { tools: _originalTools, toolConfig: _originalToolConfig, ...requestWithoutTools } = body.request || {};
    stripBlacklisted(requestWithoutTools);

    const generationConfig = { ...(requestWithoutTools.generationConfig || {}) };
    if (generationConfig.maxOutputTokens > MAX_ANTIGRAVITY_OUTPUT_TOKENS) {
      generationConfig.maxOutputTokens = MAX_ANTIGRAVITY_OUTPUT_TOKENS;
    }

    const transformedRequest = {
      ...requestWithoutTools,
      generationConfig,
      ...(contents && { contents }),
      ...(tools && { tools }),
      sessionId,
      safetySettings: undefined,
      ...(tools?.length > 0 && { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } })
    };

    stripBlacklisted(body);

    this._lastSessionId = transformedRequest.sessionId;

    // Official Antigravity client omits `requestType` entirely on the agent
    // (chat) path. Sending `requestType: "agent"` makes Google bucket the
    // request and return a detail-free 429 RESOURCE_EXHAUSTED even with quota
    // available. `image_gen` and `search` buckets keep their own requestType.
    delete body.requestType;

    return {
      ...body,
      project: projectId,
      model: body.model || model,
      userAgent: "antigravity",
      requestId: buildIdeRequestId({ body, request: transformedRequest, credentials, model, requestType: "agent" }),
      request: transformedRequest
    };
  }

  async refreshCredentials(credentials: any, log: any, proxyOptions: any = null) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      }, proxyOptions);

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error: any) {
      log?.error?.("TOKEN", `Antigravity refresh error: ${error.message}`);
      return null;
    }
  }

  generateProjectId(): string {
    const adj = ["useful", "bright", "swift", "calm", "bold"][Math.floor(Math.random() * 5)];
    const noun = ["fuze", "wave", "spark", "flow", "core"][Math.floor(Math.random() * 5)];
    return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
  }

  generateSessionId(): string {
    return crypto.randomUUID() + Date.now().toString();
  }

  parseRetryHeaders(headers: any) {
    if (!headers?.get) return null;

    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
      }
    }

    const resetAfter = headers.get("x-ratelimit-reset-after");
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }

    const resetTimestamp = headers.get("x-ratelimit-reset");
    if (resetTimestamp) {
      const ts = parseInt(resetTimestamp, 10) * 1000;
      const diff = ts - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  parseRetryFromErrorMessage(errorMessage: string) {
    if (!errorMessage || typeof errorMessage !== "string") return null;

    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000;
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000;
    if (match[3]) totalMs += parseInt(match[3]) * 1000;

    return totalMs > 0 ? totalMs : null;
  }

  extractErrorMessage(errorJson: any, bodyText = "") {
    return [
      errorJson?.error?.message,
      errorJson?.message,
      errorJson?.error,
      bodyText,
    ].filter(Boolean).map(v => typeof v === "string" ? v : JSON.stringify(v)).join("\n");
  }

  isTransientAntigravityError(status: number, message: string) {
    if (status === HTTP_STATUS.RATE_LIMITED) return true;
    if (ANTIGRAVITY_TRANSIENT_STATUSES.has(status)) return true;
    return ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message || ""));
  }

  computeRetryDelay = async (response: any, attempt: any): Promise<any> => {
    let bodyText = "";
    let errorJson = null;
    let retryMs = this.parseRetryHeaders(response.headers);

    try {
      bodyText = await response.clone().text();
      errorJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      // ignore parse errors
    }

    const errorMessage = this.extractErrorMessage(errorJson, bodyText);

    if (!retryMs) {
      retryMs = this.parseRetryFromErrorMessage(errorMessage);
    }
    if (retryMs) return retryMs <= MAX_RETRY_AFTER_MS ? retryMs : false;

    if (!this.isTransientAntigravityError(response.status, errorMessage)) return false;

    const cap = response.status === HTTP_STATUS.RATE_LIMITED
      ? MAX_RETRY_AFTER_MS
      : ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS;
    return Math.min(1000 * (2 ** attempt), cap);
  };

  static cloakTools(body: any, clientTool: string | null = null) {
    const tools = body.request?.tools;
    if (!tools || tools.length === 0) {
      return { cloakedBody: body, toolNameMap: null };
    }

    const isCopilot = clientTool === "github-copilot";
    const toolNameMap = new Map();
    const clientDeclarations: any[] = [];
    const decoyNames = new Set(AG_DECOY_TOOLS.map(tool => tool.name));

    for (const toolGroup of tools) {
      if (!toolGroup.functionDeclarations) continue;

      for (const func of toolGroup.functionDeclarations) {
        if (isCopilot && AG_DEFAULT_TOOLS.has(func.name)) {
          continue;
        }

        if (isCopilot && decoyNames.has(func.name)) {
          continue;
        }

        if (AG_DEFAULT_TOOLS.has(func.name)) {
          clientDeclarations.push(func);
          continue;
        }

        const suffixed = `${func.name}${AG_TOOL_SUFFIX}`;
        toolNameMap.set(suffixed, func.name);
        clientDeclarations.push({ ...func, name: suffixed });
      }
    }

    const allDeclarations: any[] = [];
    const seenNames = new Set();
    for (const decl of [...clientDeclarations, ...AG_DECOY_TOOLS]) {
      if (!decl?.name || seenNames.has(decl.name)) continue;
      seenNames.add(decl.name);
      allDeclarations.push(decl);
    }

    const cloakedContents = body.request?.contents?.map((msg: any) => {
      if (!msg.parts) return msg;

      const cloakedParts = msg.parts.map((part: any) => {
        if (part.functionCall && !AG_DEFAULT_TOOLS.has(part.functionCall.name)) {
          return {
            ...part,
            functionCall: {
              ...part.functionCall,
              name: `${part.functionCall.name}${AG_TOOL_SUFFIX}`
            }
          };
        }

        if (part.functionResponse && !AG_DEFAULT_TOOLS.has(part.functionResponse.name)) {
          return {
            ...part,
            functionResponse: {
              ...part.functionResponse,
              name: `${part.functionResponse.name}${AG_TOOL_SUFFIX}`
            }
          };
        }

        return part;
      });

      return { ...msg, parts: cloakedParts };
    });

    return {
      cloakedBody: {
        ...body,
        request: {
          ...body.request,
          tools: [{ functionDeclarations: allDeclarations }],
          contents: cloakedContents || body.request.contents
        }
      },
      toolNameMap
    };
  }
}

const AG_DECOY_TOOLS = [
  { name: "browser_subagent", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "command_status", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "find_by_name", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "generate_image", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "grep_search", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "list_dir", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "list_resources", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "mcp_sequential-thinking_sequentialthinking", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "multi_replace_file_content", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "notify_user", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "read_resource", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "read_terminal", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "read_url_content", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "replace_file_content", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "run_command", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "search_web", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "send_command_input", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "task_boundary", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "view_content_chunk", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "view_file", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } },
  { name: "write_to_file", description: "This tool is currently unavailable.", parameters: { type: "OBJECT", properties: {}, required: [] } }
];

export default AntigravityExecutor;
