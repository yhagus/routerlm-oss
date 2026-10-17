import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import { proxyAwareFetch } from "../common/proxyFetch";
import { buildAgentTaskEvent, postAgentTaskReport } from "./codebuddyTaskReport";
import { refreshExpiringCredentials } from "./refreshCoordinator";

const BASE = "https://www.codebuddy.ai";
const CONVERSATIONS_URL = `${BASE}/console/webchat/conversations`;
const COMPLETIONS_URL = `${BASE}/console/chat/completions`;
const SETTINGS_KEY_CLI = "codebuddyIntlCliDailyProbe";
const PROVIDERS = new Set(["codebuddy-intl-cli"]);
const DEFAULT_MODEL = "glm-5.2";
const DEFAULT_PROMPT = "hi";
const DEFAULT_CONV_NAME = "webchat";
const SYSTEM_PLACEHOLDER = "You are a helpful assistant.";
const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const SSE_DONE = new Set(["[DONE]", "[完成]", "[✅完成]"]);

async function resolveToken(runtime: Runtime, connection: ProviderConnection): Promise<{
  token: string;
  proxy: Record<string, unknown> | undefined;
  credentials: Record<string, any>;
}> {
  const psd = resolveV1ProviderSpecificData(connection.data);
  let proxy = resolveConnectionProxyConfig(runtime, psd);
  const hasPerConnectionProxy = proxy.connectionProxyEnabled || proxy.vercelRelayUrl;
  if (!hasPerConnectionProxy) {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const cliConfig = settings[SETTINGS_KEY_CLI] as { proxyPoolId?: string } | undefined;
    if (cliConfig?.proxyPoolId) {
      proxy = resolveConnectionProxyConfig(runtime, { ...psd, proxyPoolId: cliConfig.proxyPoolId });
    }
  }
  const hasActualProxy = proxy.connectionProxyEnabled || proxy.vercelRelayUrl;
  const effectiveProxy = hasActualProxy ? proxy : undefined;
  const credentials: Record<string, any> = {
    ...connection.data,
    authType: connection.authType,
    connectionId: connection.id,
    connectionName: connection.name || connection.id,
    email: connection.email,
    providerSpecificData: { ...psd, ...proxy },
  };
  await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions: effectiveProxy ?? {} });
  const accessToken = typeof credentials.accessToken === "string" && credentials.accessToken
    ? credentials.accessToken
    : typeof credentials.apiKey === "string" ? credentials.apiKey : "";
  if (!accessToken) throw new Error("CodeBuddy credential not available.");
  return { token: accessToken, proxy: effectiveProxy, credentials };
}

function webHeaders(token: string, uid: string, accept: string): Record<string, string> {
  return {
    Accept: accept,
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": WEB_UA,
    Origin: BASE,
    Referer: `${BASE}/`,
    "X-Domain": "www.codebuddy.ai",
    "X-Product": "SaaS",
    "X-Requested-With": "XMLHttpRequest",
    ...(uid ? { "X-User-Id": uid } : { "X-No-User-Id": "1" }),
  };
}

function conversationIdFrom(body: Record<string, unknown>): string {
  const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : null;
  const fromData = data && typeof data.conversationId === "string" ? data.conversationId : "";
  if (fromData) return fromData;
  if (typeof body.conversationId === "string") return body.conversationId;
  return "";
}

function consumeSseLine(line: string, state: { messageId: string; reply: string }): boolean {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed.startsWith("data:")) return false;
  const payload = trimmed.slice(5).trim();
  if (!payload) return false;
  if (SSE_DONE.has(payload)) return true;
  try {
    const json = JSON.parse(payload) as Record<string, unknown>;
    if (!state.messageId && json.id != null) state.messageId = String(json.id);
    const choices = Array.isArray(json.choices) ? json.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const delta = (choice as { delta?: { content?: unknown } }).delta;
      const content = delta && typeof delta.content === "string" ? delta.content : "";
      if (content) state.reply += content;
    }
  } catch {
    /* non-JSON SSE line */
  }
  return false;
}

async function readWebchatSse(response: Response): Promise<{ messageId: string; reply: string }> {
  const state = { messageId: "", reply: "" };
  const body = response.body;
  if (!body?.getReader) {
    const text = await response.text().catch(() => "");
    for (const line of text.split("\n")) {
      if (consumeSseLine(line, state)) break;
    }
    return state;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (consumeSseLine(line, state)) return state;
    }
  }
  if (buffer) consumeSseLine(buffer, state);
  return state;
}

export interface WebchatResult {
  ok: boolean;
  connectionId: string;
  conversationId?: string;
  messageId?: string;
  reply?: string;
  reported?: boolean;
  error?: string;
  status?: number;
}

export async function runWebchatForConnection(
  runtime: Runtime,
  connectionId: string,
  options: { prompt?: string; model?: string } = {},
): Promise<WebchatResult> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection) return { ok: false, connectionId, error: "Connection not found" };
  if (!PROVIDERS.has(connection.provider)) {
    return { ok: false, connectionId, error: "Web chat is only available for CodeBuddy intl CLI connections" };
  }
  const prompt = typeof options.prompt === "string" && options.prompt.trim() ? options.prompt.trim() : DEFAULT_PROMPT;
  const model = typeof options.model === "string" && options.model.trim() ? options.model.trim() : DEFAULT_MODEL;
  try {
    const { token, proxy, credentials } = await resolveToken(runtime, connection);
    const psd = credentials?.providerSpecificData && typeof credentials.providerSpecificData === "object"
      ? credentials.providerSpecificData
      : {};
    const uid = String(credentials?.codebuddyUserId || psd.codebuddyUserId || "");
    const convName = `${DEFAULT_CONV_NAME}-${crypto.randomUUID().slice(0, 8)}`;
    const convResponse = await proxyAwareFetch(CONVERSATIONS_URL, {
      method: "POST",
      headers: webHeaders(token, uid, "application/json, text/plain, */*"),
      body: JSON.stringify({ name: convName }),
      signal: AbortSignal.timeout(20_000),
    }, proxy);
    const convBody = await convResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!convResponse.ok) {
      const detail = typeof convBody.msg === "string" ? convBody.msg : JSON.stringify(convBody).slice(0, 240);
      return {
        ok: false,
        connectionId,
        status: convResponse.status,
        error: detail
          ? `Web chat conversation failed (HTTP ${convResponse.status}): ${detail}`
          : `Web chat conversation failed (HTTP ${convResponse.status})`,
      };
    }
    const conversationId = conversationIdFrom(convBody);
    if (!conversationId) {
      return { ok: false, connectionId, status: convResponse.status, error: "Web chat conversation did not return a conversationId" };
    }
    const chatResponse = await proxyAwareFetch(COMPLETIONS_URL, {
      method: "POST",
      headers: webHeaders(token, uid, "text/event-stream"),
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PLACEHOLDER },
          { role: "user", content: prompt },
        ],
        model,
        stream: true,
        conversationId,
      }),
      signal: AbortSignal.timeout(90_000),
    }, proxy);
    if (!chatResponse.ok) {
      const text = await chatResponse.text().catch(() => "");
      return {
        ok: false,
        connectionId,
        conversationId,
        status: chatResponse.status,
        error: text
          ? `Web chat failed (HTTP ${chatResponse.status}): ${text.slice(0, 240)}`
          : `Web chat failed (HTTP ${chatResponse.status})`,
      };
    }
    const { messageId, reply } = await readWebchatSse(chatResponse);
    const event = buildAgentTaskEvent(connection, credentials, { conversationId, messageId });
    const posted = await postAgentTaskReport(token, proxy, event);
    runtime.repos.usage.record({
      provider: connection.provider,
      model,
      connectionId,
      endpoint: "webchat",
      status: posted.ok ? "success" : "error",
      promptTokens: 0,
      completionTokens: 0,
      meta: { webchat: true, conversationId, messageId, reported: posted.ok },
    });
    if (!posted.ok) {
      return {
        ok: false,
        connectionId,
        conversationId,
        messageId,
        reply,
        reported: false,
        status: posted.status,
        error: posted.error,
      };
    }
    return {
      ok: true,
      connectionId,
      conversationId,
      messageId,
      reply,
      reported: true,
      status: chatResponse.status,
    };
  } catch (error) {
    return { ok: false, connectionId, error: error instanceof Error ? error.message : String(error) };
  }
}
