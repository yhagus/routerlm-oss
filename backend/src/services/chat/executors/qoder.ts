/**
 * QoderExecutor — sends OpenAI-format chat requests to Qoder's COSY-signed
 * inference endpoint, then unwraps Qoder's `{statusCodeValue, body}` SSE
 * envelope back into plain OpenAI SSE for the rest of the pipeline.
 *
 * Ported from the upstream open-sse/executors/qoder.js.
 */

import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../../providers/config/providers.ts";
import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { qoderEncodeBody } from "../../providers/cli-auth/qoder/encoding.ts";
import { buildCosyHeaders } from "../../providers/cli-auth/qoder/cosy.ts";
import {
  QODER_CHAT_SIG_PATH,
  QODER_CONTEXT_TIER_ENV,
  qoderInferenceBase,
} from "../../providers/cli-auth/qoder/constants.ts";
import { SSE_DONE } from "../utils/sseConstants.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../../providers/config/runtimeConfig.ts";
import { OPENAI_BLOCK, CLAUDE_BLOCK } from "../translator/schema/index.js";
import { encodeDataUri } from "../translator/concerns/image.ts";
import { createQoderSseCoalescer } from "../../providers/cli-auth/qoder/sse.ts";
import { rewriteQoderMessageAttachments } from "../../providers/cli-auth/qoder/attachments.ts";
import {
  resolveQoderContextTier,
  applyQoderContextTier,
} from "../../providers/cli-auth/qoder/contextTier.ts";
import {
  getQoderModelConfig,
  resolveQoderModels,
  isQoderPat,
} from "../../providers/discovery/qoderModels.ts";

let modelContextWindowResolver: any = null;

export function setQoderModelContextWindowResolver(resolver: any) {
  modelContextWindowResolver = typeof resolver === "function" ? resolver : null;
}

async function lookupModelContextWindow(provider: any, model: any) {
  if (modelContextWindowResolver) return modelContextWindowResolver(provider, model);
  const { getModelContextWindow } = await import("../../platform/db/modelContextWindowsDb");
  return getModelContextWindow(provider, model);
}

function normalizeMessages(messages: any) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], systemText: "" };
  }
  const systemParts: string[] = [];
  const out: any[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role === "system") {
      const text = extractText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }
    const cloned = { ...msg };
    cloned.content = normalizeContent(msg.content);
    out.push(cloned);
  }
  return { messages: out, systemText: systemParts.join("\n\n") };
}

function normalizeContent(content: any) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content)) return String(content);

  const blocks: any[] = [];
  const textParts: string[] = [];
  let hasImage = false;

  const pushText = (text: string) => {
    if (!text) return;
    if (hasImage || blocks.length) blocks.push({ type: OPENAI_BLOCK.TEXT, text });
    else textParts.push(text);
  };

  const imageUrlOf = (item: any) => {
    if (typeof item.image_url === "string" && item.image_url) return item.image_url;
    if (typeof item.image_url?.url === "string" && item.image_url.url) return item.image_url.url;
    return null;
  };

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const imageUrl = item.type === OPENAI_BLOCK.IMAGE_URL ? imageUrlOf(item) : null;
    if (imageUrl) {
      blocks.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url: imageUrl } });
      hasImage = true;
    } else if (item.type === CLAUDE_BLOCK.IMAGE && item.source) {
      const src = item.source;
      const url = src.type === "base64" && src.data
        ? encodeDataUri(src.media_type || "image/png", src.data)
        : typeof src.url === "string" && src.url ? src.url : null;
      if (url) {
        blocks.push({ type: OPENAI_BLOCK.IMAGE_URL, image_url: { url } });
        hasImage = true;
      }
    } else if (item.type === OPENAI_BLOCK.FILE) {
      const name = item.file?.filename || item.file?.name || "file";
      pushText(`[file omitted: ${name} — Qoder reads documents via its file API, not inlined bytes]`);
    } else if (item.type === CLAUDE_BLOCK.DOCUMENT) {
      const name = item.title || "document";
      pushText(`[file omitted: ${name} — Qoder reads documents via its file API, not inlined bytes]`);
    } else if (typeof item.text === "string" && item.text) {
      pushText(item.text);
    }
  }

  if (!hasImage) return textParts.join("\n");
  if (textParts.length) blocks.unshift({ type: OPENAI_BLOCK.TEXT, text: textParts.join("\n") });
  return blocks;
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object") {
        if (item.type === "text" && typeof item.text === "string") {
          parts.push(item.text);
        } else if (typeof item.text === "string") {
          parts.push(item.text);
        }
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

function lastUserText(messages: any): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return extractText(m.content);
  }
  return "";
}

function stableHash(prefix: string, ...parts: any[]): string {
  const h = createHash("sha256");
  h.update(prefix);
  for (const p of parts) {
    h.update("\0");
    h.update(String(p ?? ""));
  }
  return h.digest("hex").slice(0, 16);
}

function stableChatRecordId(model: any, messages: any, tools: any, maxTokens: number): string {
  const h = createHash("sha256");
  h.update("qoder-record\0");
  h.update(String(model));
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role) { h.update("\0"); h.update(m.role); }
    if (typeof m.content === "string" && m.content) {
      h.update("\0"); h.update(m.content);
    } else if (Array.isArray(m.content)) {
      h.update("\0");
      try { h.update(JSON.stringify(m.content)); } catch {}
    }
  }
  if (tools) {
    h.update("\0");
    try { h.update(JSON.stringify(tools)); } catch {}
  }
  h.update(`\0mt=${maxTokens}`);
  return h.digest("hex").slice(0, 16);
}

function truncate(s: any, n: number): string {
  return s && s.length > n ? `${s.slice(0, n)}...` : s || "";
}

function isBillingBlock(inner: any): boolean {
  if (!inner || typeof inner !== "string") return false;
  const lowerMsg = inner.toLowerCase();
  return /\"code\"\s*:\s*\"(112|10605)\"/.test(inner) || lowerMsg.includes("pricingurl");
}

async function peekFirstQoderFrame(reader: any, decoder: any): Promise<any> {
  let consumed = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return { isBilling: false, consumed, upstreamDone: true };

    consumed += decoder.decode(value, { stream: true });
    const nl = consumed.indexOf("\n");
    if (nl === -1) continue;

    const line = consumed.slice(0, nl).replace(/\r$/, "").trim();
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trimStart();
    if (data === "[DONE]") return { isBilling: false, consumed };

    let envelope: any;
    try { envelope = JSON.parse(data); } catch { return { isBilling: false, consumed }; }

    const statusVal = typeof envelope.statusCodeValue === "number" ? envelope.statusCodeValue : 200;
    const inner = typeof envelope.body === "string" ? envelope.body : "";

    if (statusVal !== 200 && isBillingBlock(inner)) {
      return { isBilling: true, statusVal, message: inner || `qoder billing block (${statusVal})` };
    }
    // Non-billing error (401/403/etc): surface as HTTP error so chatCore
    // can trigger account failover instead of leaking error text into chat.
    if (statusVal >= 400) {
      return { isError: true, statusVal, message: inner || `upstream status ${statusVal}` };
    }
    return { isBilling: false, consumed };
  }
}

async function wrapQoderSSE(response: any, model: any): Promise<Response> {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  const peek = await peekFirstQoderFrame(reader, decoder);
  if (peek?.isBilling) {
    await reader.cancel().catch(() => {});
    return new Response(
      JSON.stringify({ error: { message: peek.message, code: peek.statusVal } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  if (peek?.isError) {
    await reader.cancel().catch(() => {});
    return new Response(
      JSON.stringify({ error: { message: peek.message } }),
      { status: peek.statusVal, headers: { "Content-Type": "application/json" } },
    );
  }

  let buffer = peek.consumed || "";
  const upstreamDrained = peek.upstreamDone === true;
  const encoder = new TextEncoder();
  let doneEmitted = false;
  const coalescer = createQoderSseCoalescer({ model, encoder, sseDone: SSE_DONE });

  const syncDone = () => {
    if (coalescer.doneEmitted) doneEmitted = true;
  };

  const processLine = (line: any, controller: any) => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("data:")) return;
    if (doneEmitted) return;

    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]") {
      coalescer.flush(controller);
      syncDone();
      return;
    }

    let envelope: any;
    try { envelope = JSON.parse(data); } catch { return; }
    const statusVal = typeof envelope.statusCodeValue === "number" ? envelope.statusCodeValue : 200;
    const inner = typeof envelope.body === "string"
      ? envelope.body
      : envelope.body != null ? JSON.stringify(envelope.body) : "";
    if (statusVal !== 200) {
      const msg = inner || `upstream status ${statusVal}`;
      const errChunk = JSON.stringify({
        id: `qoder-error-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: `\n[qoder error ${statusVal}: ${truncate(msg, 200)}]` }, finish_reason: "stop" }],
      });
      controller.enqueue(encoder.encode(`data: ${errChunk}\n\n`));
      controller.enqueue(encoder.encode(SSE_DONE));
      doneEmitted = true;
      return;
    }
    if (!inner) return;
    coalescer.handleInner(inner, controller);
    syncDone();
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let nlSeed;
        while ((nlSeed = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlSeed);
          buffer = buffer.slice(nlSeed + 1);
          processLine(line, controller);
          if (doneEmitted) {
            await reader.cancel().catch(() => {});
            controller.close();
            return;
          }
        }
        if (upstreamDrained) {
          buffer += decoder.decode();
          if (buffer.length > 0) {
            processLine(buffer, controller);
            buffer = "";
          }
        }

        while (!doneEmitted && !upstreamDrained) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.length > 0) {
              processLine(buffer, controller);
              buffer = "";
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            processLine(line, controller);
            if (doneEmitted) {
              await reader.cancel().catch(() => {});
              controller.close();
              return;
            }
          }
        }
      } catch {
        // fall through to terminal [DONE] + close
      } finally {
        if (!doneEmitted) {
          try {
            coalescer.flush(controller);
            doneEmitted = true;
          } catch { /* already closed */ }
        }
        try { controller.close(); } catch { /* already closed */ }
        await reader.cancel().catch(() => {});
      }
    },
    cancel() {
      return reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

function tokenExpiry(credentials: any): number {
  const raw = credentials?.expiresAt;
  if (!raw) return 0;
  const timestamp = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function resolveCredentials(credentials: any): Promise<any> {
  const providerSpecificData = credentials?.providerSpecificData || {};
  let accessToken = String(credentials?.accessToken || "").trim();
  let userId = String(providerSpecificData.userId || "").trim();
  const personalAccessToken = String(providerSpecificData.personalAccessToken || "").trim();

  if ((!accessToken || (tokenExpiry(credentials) && tokenExpiry(credentials) <= Date.now() + 60_000)) && personalAccessToken) {
    const { loginWithQoderPat } = await import("../../providers/cli-auth/qoder/pat.ts");
    const exchanged = await loginWithQoderPat(personalAccessToken);
    accessToken = exchanged.accessToken;
    userId = userId || exchanged.userId || "";
    credentials.accessToken = accessToken;
    credentials.refreshToken = exchanged.refreshToken || credentials.refreshToken || null;
    credentials.expiresAt = exchanged.expireTime ? new Date(exchanged.expireTime).toISOString() : credentials.expiresAt;
    credentials.providerSpecificData = {
      ...providerSpecificData,
      authMethod: "pat",
      userId,
      personalAccessToken,
    };
  }

  if (!accessToken) throw new Error("qoder credential is missing accessToken");
  if (!userId) throw new Error("qoder credential is missing userId");

  const machineId = String(providerSpecificData.machineId || uuidv4());
  return {
    ...credentials,
    accessToken,
    userId,
    providerSpecificData: {
      ...providerSpecificData,
      userId,
      machineId,
    },
  };
}

async function buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal }: any) {
  const qoderKey = String(model || "").replace(/^qoder\//, "");

  let modelConfig = await getQoderModelConfig(credentials, qoderKey, { log, proxyOptions, signal });
  if (!modelConfig) {
    const refreshed = await resolveQoderModels(credentials, { forceRefresh: true, log, proxyOptions, signal });
    const retried = refreshed?.rawConfigs.get(qoderKey);
    if (!retried) {
      throw new Error(
        `qoder: model_config for "${qoderKey}" not yet known (run a model list fetch or check upstream connectivity)`,
      );
    }
    modelConfig = { ...retried, key: qoderKey };
  }

  const incoming = Array.isArray(body.messages)
    ? body.messages.map((m: any) => {
      if (!m || typeof m !== "object") return m;
      return {
        ...m,
        content: Array.isArray(m.content)
          ? m.content.map((b: any) => (b && typeof b === "object" ? { ...b } : b))
          : m.content,
      };
    })
    : [];
  try {
    await rewriteQoderMessageAttachments(incoming, {
      credentials,
      log,
      proxyOptions,
      signal,
    });
  } catch (err: any) {
    log?.warn?.("QODER", `attachment rewrite failed: ${err.message}`);
  }

  const { messages, systemText } = normalizeMessages(incoming);
  const tools = body.tools;
  const isReasoning = !!modelConfig.is_reasoning;
  const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;

  let maxTokens = 32_768;
  if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
  if (typeof body.max_tokens === "number" && body.max_tokens > 0 && body.max_tokens < maxTokens) {
    maxTokens = body.max_tokens;
  }
  if (typeof body.max_completion_tokens === "number" && body.max_completion_tokens > 0 && body.max_completion_tokens < maxTokens) {
    maxTokens = body.max_completion_tokens;
  }

  // Context-window override from the v2 kv store (fork improvement).
  let contextWindowOverride: number | null = null;
  try {
    contextWindowOverride = await lookupModelContextWindow("qoder", model);
  } catch (err: any) {
    log?.warn?.("QODER", `context window override lookup failed: ${err.message}`);
  }
  if (contextWindowOverride && contextWindowOverride > 0) {
    modelConfig = { ...modelConfig, max_input_tokens: Math.floor(contextWindowOverride) };
  }

  const lastUser = lastUserText(messages);
  const psd = credentials.providerSpecificData || {};
  const sessionId = stableHash("qoder-session", psd.userId, qoderKey);
  const recordId = stableChatRecordId(qoderKey, messages, tools, maxTokens);

  const tierChoice = resolveQoderContextTier(
    modelConfig,
    { system: systemText, messages, tools },
    { preference: process.env[QODER_CONTEXT_TIER_ENV] },
  );
  if (tierChoice) {
    log?.info?.(
      "QODER",
      `context tier ${tierChoice.tier.name} (${tierChoice.tier.tokenCount} tokens, ${tierChoice.reason}) for ~${tierChoice.estimatedTokens} prompt tokens`,
    );
  }

  const payload = {
    request_id: uuidv4(),
    request_set_id: recordId,
    chat_record_id: recordId,
    session_id: sessionId,
    stream: true,
    chat_task: "FREE_INPUT",
    is_reply: true,
    is_retry: false,
    source: 1,
    version: "3",
    session_type: "qodercli",
    agent_id: "agent_common",
    task_id: "common",
    code_language: "",
    chat_prompt: "",
    image_urls: null,
    aliyun_user_type: "",
    system: systemText,
    messages,
    tools: Array.isArray(tools) ? tools : [],
    parameters: { max_tokens: maxTokens },
    chat_context: {
      chatPrompt: "",
      imageUrls: null,
      extra: {
        context: [],
        modelConfig: { key: qoderKey, is_reasoning: isReasoning },
        originalContent: lastUser,
      },
      features: [],
      text: lastUser,
    },
    model_config: modelConfig,
    business: {
      product: "cli",
      version: "1.0.0",
      type: "agent",
      stage: "start",
      id: uuidv4(),
      name: truncate(lastUser, 30),
      begin_at: Date.now(),
    },
  };

  if (tierChoice) applyQoderContextTier(payload, tierChoice.tier);
  return { qoderKey, payload, modelConfig };
}

function makeFakeResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class QoderExecutor extends BaseExecutor {
  constructor() {
    super("qoder", PROVIDERS.qoder);
  }

  buildUrl(credentials: any): string {
    return `${qoderInferenceBase(credentials)}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: any) {
    const rawToken = credentials?.apiKey || credentials?.accessToken;
    if (isQoderPat(rawToken)) {
      try {
        credentials = await resolveCredentials(credentials);
      } catch (err: any) {
        log?.error?.("QODER", `PAT exchange failed: ${err.message}`);
        return {
          response: makeFakeResponse(401, `qoder PAT exchange failed: ${err.message}`),
          url: this.buildUrl(credentials),
          headers: {} as Record<string, any>,
          transformedBody: body,
        };
      }
    } else {
      try {
        credentials = await resolveCredentials(credentials);
      } catch (err: any) {
        return {
          response: makeFakeResponse(401, err.message),
          url: this.buildUrl(credentials),
          headers: {} as Record<string, any>,
          transformedBody: body,
        };
      }
    }

    const url = this.buildUrl(credentials);
    const psd = credentials?.providerSpecificData || {};
    if (!psd.userId) {
      return {
        response: makeFakeResponse(401, "qoder credential is missing userId; reconnect the account"),
        url,
        headers: {} as Record<string, any>,
        transformedBody: body,
      };
    }
    if (!credentials?.accessToken) {
      return {
        response: makeFakeResponse(401, "qoder credential is missing accessToken; reconnect the account"),
        url,
        headers: {} as Record<string, any>,
        transformedBody: body,
      };
    }

    let qoderKey: string;
    let payload: any;
    try {
      const built = await buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal });
      qoderKey = built.qoderKey;
      payload = built.payload;
    } catch (err: any) {
      return {
        response: makeFakeResponse(400, err.message),
        url,
        headers: {} as Record<string, any>,
        transformedBody: body,
      };
    }

    const plainBody = Buffer.from(JSON.stringify(payload), "utf8");
    const encodedBodyStr = qoderEncodeBody(plainBody);
    const encodedBodyBuf = Buffer.from(encodedBodyStr, "latin1");

    let cosyHeaders: Record<string, string>;
    try {
      cosyHeaders = buildCosyHeaders(encodedBodyBuf, url, {
        userId: psd.userId,
        authToken: credentials.accessToken,
        name: credentials.displayName || "",
        email: credentials.email || "",
        machineId: psd.machineId || "",
      });
    } catch (err: any) {
      return {
        response: makeFakeResponse(401, `qoder cosy signing failed: ${err.message}`),
        url,
        headers: {} as Record<string, any>,
        transformedBody: body,
      };
    }

    const modelSource = (payload.model_config && payload.model_config.source) || "system";
    const headers: Record<string, any> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Model-Key": qoderKey,
      "X-Model-Source": modelSource,
      "Accept-Encoding": "identity",
      ...cosyHeaders,
    };

    const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
    const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

    let response: Response;
    try {
      response = await proxyAwareFetch(
        url,
        { method: "POST", headers, body: encodedBodyBuf, signal: mergedSignal },
        proxyOptions,
      );
    } finally {
      clearTimeout(connectTimer);
    }

    if (!response.ok) {
      return { response, url, headers, transformedBody: payload };
    }

    const wrapped = await wrapQoderSSE(response, `qoder/${qoderKey}`);
    return { response: wrapped, url, headers, transformedBody: payload };
  }

  async refreshCredentials(credentials: any) {
    const pat = credentials?.providerSpecificData?.personalAccessToken;
    if (!pat) return null;
    const { loginWithQoderPat } = await import("../../providers/cli-auth/qoder/pat.ts");
    const result = await loginWithQoderPat(pat);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || credentials.refreshToken || null,
      expiresAt: result.expireTime ? new Date(result.expireTime).toISOString() : credentials.expiresAt || null,
      providerSpecificData: {
        ...(credentials.providerSpecificData || {}),
        authMethod: "pat",
        userId: result.userId || credentials.providerSpecificData?.userId || "",
        personalAccessToken: pat,
      },
    };
  }

  parseError(response: any, bodyText: any) {
    if (response.status === 403) {
      return { status: 403, message: bodyText || "Qoder quota exhausted", disableAccount: true };
    }
    return super.parseError(response, bodyText);
  }
}

export default QoderExecutor;
