import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

const CHAT_URL = "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
const MODEL_LIST_URL = "https://api3.qoder.sh/algo/api/v2/model/list";
const MODEL_LIST_URL_ALT = "https://api2.qoder.sh/algo/api/v2/model/list";
const EXCHANGE_URL = "https://openapi.qoder.sh/api/v1/jobToken/exchange";
const USERINFO_URL = "https://openapi.qoder.sh/api/v1/userinfo";

// Mirror of open-sse/shared/qoder/encoding.js: qoderEncodeBody is one-way on
// the wire, so the inverse lives here to assert on the encoded request body.
const STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CUSTOM_ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";

function qoderDecodeBody(encoded: string): Record<string, any> {
  let mapped = "";
  for (const ch of encoded) {
    if (ch === "$") mapped += "=";
    else {
      const index = CUSTOM_ALPHABET.indexOf(ch);
      mapped += index >= 0 ? STD_ALPHABET[index] : ch;
    }
  }
  const n = mapped.length;
  const a = Math.floor(n / 3);
  const std = mapped.slice(n - a) + mapped.slice(a, n - a) + mapped.slice(0, a);
  return JSON.parse(Buffer.from(std, "base64").toString("utf8"));
}

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-qoder-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

// Qoder's upstream SSE wraps each OpenAI chunk inside a `body` string field.
const envelope = (chunk: Record<string, unknown>) => `data: ${JSON.stringify({ body: JSON.stringify(chunk) })}\n\n`;
const roleChunk = (content: string) => ({ id: "qc1", object: "chat.completion.chunk", model: "ultimate", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] });
const deltaChunk = (content: string) => ({ id: "qc1", object: "chat.completion.chunk", model: "ultimate", choices: [{ index: 0, delta: { content }, finish_reason: null }] });
const finishChunk = () => ({ id: "qc1", object: "chat.completion.chunk", model: "ultimate", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 7, total_tokens: 11 } });
const goodStream = [envelope(roleChunk("qoder ")), envelope(deltaChunk("works")), envelope(finishChunk()), "data: [DONE]\n\n"].join("");

// Live model list response from /algo/api/v2/model/list
const MODEL_LIST_RESPONSE = {
  chat: [
    { key: "ultimate", display_name: "Ultimate", max_input_tokens: 180000, is_vl: true, is_reasoning: true, max_output_tokens: 32768, source: "system" },
    { key: "auto", display_name: "Auto", max_input_tokens: 180000, is_vl: true, is_reasoning: false, max_output_tokens: 32768, source: "system" },
  ],
};

interface CapturedCall { url: string; init?: RequestInit }

function chatRequest(extra: Record<string, unknown> = {}) {
  return new Request("http://local/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qoder/ultimate", messages: [{ role: "user", content: "hi" }], ...extra }),
  });
}

function mockFetchWithModelList(capture: CapturedCall[], streamFn?: (input: RequestInfo | URL) => Response) {
  installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    capture.push({ url, init });
    if (url === MODEL_LIST_URL || url === MODEL_LIST_URL_ALT) return Response.json(MODEL_LIST_RESPONSE);
    return streamFn ? streamFn(input) : new Response(goodStream, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
}

describe("qoder executor", () => {
  test("chat streams through the COSY wire protocol and records usage", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "qoder", authType: "oauth", name: "Q1", credentials: { accessToken: "sess-token", userId: "u-1" } });
      const calls: CapturedCall[] = [];
      mockFetchWithModelList(calls);

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", chatRequest({ stream: true }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const text = await response.text();
      expect(text).toContain("chat.completion.chunk");
      expect(text).toContain("qoder ");
      expect(text).toContain("works");
      expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);

      const chatCall = calls.find((c) => c.url === CHAT_URL);
      expect(chatCall).toBeTruthy();
      const headers = chatCall!.init?.headers as Record<string, string>;
      expect(headers["Authorization"].startsWith("Bearer COSY.")).toBe(true);
      expect(headers["Cosy-User"]).toBe("u-1");
      expect(headers["Content-Type"]).toBe("application/json");

      const payload = qoderDecodeBody(String(chatCall!.init?.body));
      expect(payload.model_config.key).toBe("ultimate");
      expect(payload.stream).toBe(true);
      expect(Array.isArray(payload.messages)).toBe(true);

      const summary = instance.repos.usage.summary("/all");
      expect(summary.requests).toBe(1);
      expect(summary.total_tokens).toBe(11);
    } finally {
      instance.close();
    }
  });

  test("non-streaming clients receive the buffered forced-stream completion", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "qoder", authType: "oauth", credentials: { accessToken: "sess-token", userId: "u-1" } });
      const calls: CapturedCall[] = [];
      mockFetchWithModelList(calls);

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", chatRequest({ stream: false }));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.choices[0].message.role).toBe("assistant");
      expect(payload.choices[0].message.content).toBe("qoder works");
      expect(payload.usage.total_tokens).toBe(11);
      expect(instance.repos.usage.summary("/all").total_tokens).toBe(11);
    } finally {
      instance.close();
    }
  });

  test("context-window overrides come from the v2 kv store", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "qoder", authType: "oauth", credentials: { accessToken: "sess-token", userId: "u-1" } });
      const bodies: string[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === MODEL_LIST_URL || url === MODEL_LIST_URL_ALT) return Response.json(MODEL_LIST_RESPONSE);
        if (url === CHAT_URL) bodies.push(String(init?.body));
        return new Response(goodStream, { status: 200, headers: { "content-type": "text/event-stream" } });
      });

      instance.sqlite.query("INSERT INTO kv(scope, key, value) VALUES('modelContextWindows', 'qoder/ultimate', '128000')").run();
      const app = createApp(instance);
      const overridden = await app.request("/v1/chat/completions", chatRequest());
      expect(overridden.status).toBe(200);
      expect(qoderDecodeBody(bodies[0]).model_config.max_input_tokens).toBe(128000);

      instance.sqlite.query("DELETE FROM kv WHERE scope = 'modelContextWindows'").run();
      const defaulted = await app.request("/v1/chat/completions", chatRequest());
      expect(defaulted.status).toBe(200);
      expect(qoderDecodeBody(bodies[1]).model_config.max_input_tokens).toBe(180000);
    } finally {
      instance.close();
    }
  });

  test("an SSE-wrapped auth envelope fails over to the next account", async () => {
    const instance = await runtime();
    try {
      const first = instance.repos.providers.create({ provider: "qoder", authType: "oauth", name: "A", credentials: { accessToken: "sess-a", userId: "u-a" }, priority: 0 });
      instance.repos.providers.create({ provider: "qoder", authType: "oauth", name: "B", credentials: { accessToken: "sess-b", userId: "u-b" }, priority: 1 });
      let chatCalls = 0;
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === MODEL_LIST_URL || url === MODEL_LIST_URL_ALT) return Response.json(MODEL_LIST_RESPONSE);
        chatCalls += 1;
        if (chatCalls === 1) return new Response(`data: ${JSON.stringify({ statusCodeValue: 401, message: "token expired" })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
        return new Response(goodStream, { status: 200, headers: { "content-type": "text/event-stream" } });
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", chatRequest());
      expect(response.status).toBe(200);
      expect((await response.json()).choices[0].message.content).toBe("qoder works");
      const cooled = instance.repos.providers.get(first.id);
      expect(Object.keys(cooled?.data || {}).some((key) => key.startsWith("modelLock_"))).toBe(true);
      expect(cooled?.data.testStatus).toBe("unavailable");
    } finally {
      instance.close();
    }
  });

  test("a 403 quota envelope permanently disables the account", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "qoder", authType: "oauth", name: "A", credentials: { accessToken: "sess-a", userId: "u-a" }, priority: 0 });
      instance.repos.providers.create({ provider: "qoder", authType: "oauth", name: "B", credentials: { accessToken: "sess-b", userId: "u-b" }, priority: 1 });
      let chatCalls = 0;
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === MODEL_LIST_URL || url === MODEL_LIST_URL_ALT) return Response.json(MODEL_LIST_RESPONSE);
        chatCalls += 1;
        if (chatCalls === 1) return new Response(`data: ${JSON.stringify({ statusCodeValue: 403, message: "quota exhausted" })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
        return new Response(goodStream, { status: 200, headers: { "content-type": "text/event-stream" } });
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", chatRequest());
      expect(response.status).toBe(200);
      const disabled = instance.repos.providers.get(connection.id);
      expect(disabled?.isActive).toBe(false);
      expect(disabled?.data.testStatus).toBe("unavailable");
    } finally {
      instance.close();
    }
  });

  test("a PAT-only connection exchanges the PAT before chatting", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "qoder", authType: "oauth", credentials: { personalAccessToken: "pt-1" } });
      const seen: CapturedCall[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, init });
        if (url === EXCHANGE_URL) return Response.json({ token: "jt-1", refresh_token: "rt-1", expires_at: Date.now() + 3600_000 });
        if (url === USERINFO_URL) return Response.json({ uid: "u-9", name: "Pat", email: "pat@example.com" });
        if (url === MODEL_LIST_URL || url === MODEL_LIST_URL_ALT) return Response.json(MODEL_LIST_RESPONSE);
        return new Response(goodStream, { status: 200, headers: { "content-type": "text/event-stream" } });
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", chatRequest());
      expect(response.status).toBe(200);

      const exchange = seen.find((call) => call.url === EXCHANGE_URL);
      expect(JSON.parse(String(exchange?.init?.body))).toEqual({ personal_token: "pt-1" });
      const chat = seen.find((call) => call.url.includes("agent_chat_generation"));
      expect((chat?.init?.headers as Record<string, string>)["Cosy-User"]).toBe("u-9");
      expect((chat?.init?.headers as Record<string, string>)["Authorization"].startsWith("Bearer COSY.")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("a 401 refreshes the PAT session and persists the new token", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "qoder", authType: "oauth", credentials: { accessToken: "stale-session", userId: "u-1", personalAccessToken: "pt-1" } });
      let chatCalls = 0;
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === EXCHANGE_URL) return Response.json({ token: "jt-2", refresh_token: "rt-2", expires_at: Date.now() + 3600_000 });
        if (url === USERINFO_URL) return Response.json({ uid: "u-1" });
        if (url === MODEL_LIST_URL || url === MODEL_LIST_URL_ALT) return Response.json(MODEL_LIST_RESPONSE);
        chatCalls += 1;
        if (chatCalls === 1) return Response.json({ error: { message: "session expired" } }, { status: 401 });
        return new Response(goodStream, { status: 200, headers: { "content-type": "text/event-stream" } });
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", chatRequest());
      expect(response.status).toBe(200);
      expect((await response.json()).choices[0].message.content).toBe("qoder works");
      expect(chatCalls).toBe(2);
      const persisted = instance.repos.providers.get(connection.id);
      expect(persisted?.data.accessToken).toBe("jt-2");
      expect(persisted?.data.testStatus).toBe("active");
    } finally {
      instance.close();
    }
  });
});
