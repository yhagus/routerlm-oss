import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { getV2Executor } from "../src/services/chat/executors";
import { selectChatConnection } from "../src/services/chat/credentials";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-exec-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

const completion = (text: string) => ({
  id: "chatcmpl-exec-1",
  object: "chat.completion",
  model: "mistral-large-latest",
  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 },
});

describe("v2 specialized executor path", () => {
  test("registry exposes the v1 specialized executors and gates the impure ones", () => {
    expect(getV2Executor("codex")).toBeTruthy();
    expect(getV2Executor("qoder")).toBeTruthy();
    expect(getV2Executor("gcli")).toBe(getV2Executor("grok-cli"));
    expect(getV2Executor("openai")).toBeTruthy();
  });

  test("chat selection resolves proxy-pool settings into executor credentials", async () => {
    const instance = await runtime();
    try {
      const pool = instance.repos.proxies.create({ name: "Relay", proxyUrl: "https://relay.test", type: "vercel", isActive: true, data: { name: "Relay", proxyUrl: "https://relay.test", type: "vercel", isActive: true } });
      instance.repos.providers.create({ provider: "openai", authType: "apikey", credentials: { apiKey: "key" }, data: { proxyPoolId: pool.id } });

      const selected = selectChatConnection(instance, "openai");
      expect(selected.selected?.credentials.providerSpecificData).toMatchObject({
        proxyPoolId: pool.id,
        connectionProxyEnabled: false,
        vercelRelayUrl: "https://relay.test",
      });
    } finally {
      instance.close();
    }
  });

  test("chat routes through a specialized executor and records usage", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return Response.json(completion("executor says hi"));
      });

      const app = createApp(instance);
      // v1 defaults to SSE when `stream` is omitted; JSON tests must opt out.
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: false, messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.object).toBe("chat.completion");
      expect(payload.choices[0].message.content).toBe("executor says hi");
      expect(calls[0].url).toBe("https://api.mistral.ai/v1/chat/completions");
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer mistral-key");
      expect(instance.repos.usage.summary("/all").requests).toBe(1);
      expect(instance.repos.usage.summary("/all").total_tokens).toBe(10);
    } finally {
      instance.close();
    }
  });

  test("River AI sends chat requests to its Responses endpoint with the API key", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "river", authType: "apikey", credentials: { apiKey: "river-key" } });
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return Response.json({
          id: "resp_river_1",
          object: "response",
          status: "completed",
          model: "zai-org/GLM-5.3-Flash",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "river says hi" }] }],
          usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
        });
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "river/zai-org/GLM-5.3-Flash", stream: false, messages: [{ role: "user", content: "Hello" }] }) });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.choices[0].message.content).toBe("river says hi");
      expect(calls[0].url).toBe("https://api.river.ai/v1/responses");
      expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer river-key");
      const upstreamBody = JSON.parse(String(calls[0].init?.body));
      expect(upstreamBody.model).toBe("zai-org/GLM-5.3-Flash");
      expect(upstreamBody.input).toBeDefined();
      expect(upstreamBody.messages).toBeUndefined();
    } finally {
      instance.close();
    }
  });

  test("a 401 account falls back to the next account and is cooled down", async () => {
    const instance = await runtime();
    try {
      const first = instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "A", credentials: { apiKey: "key-a" }, priority: 0 });
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "B", credentials: { apiKey: "key-b" }, priority: 1 });
      const seenTokens: string[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/chat/completions")) seenTokens.push((init?.headers as Record<string, string>).Authorization);
        if (seenTokens.length === 1) return Response.json({ error: { message: "bad token" } }, { status: 401 });
        return Response.json(completion("from account B"));
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: false, messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      expect((await response.json()).choices[0].message.content).toBe("from account B");
      expect(seenTokens).toEqual(["Bearer key-a", "Bearer key-b"]);
      const cooled = instance.repos.providers.get(first.id);
      expect(Object.keys(cooled?.data || {}).some((key) => key.startsWith("modelLock_"))).toBe(true);
      expect(cooled?.data.testStatus).toBe("unavailable");
      expect(cooled?.data.errorCode).toBe(401);
    } finally {
      instance.close();
    }
  });

  test("combos fall through models with v1 fallback semantics", async () => {
    const instance = await runtime();
    try {
      instance.repos.combos.create({ name: "exec-combo", models: ["mistral/mistral-large-latest", "mistral/codestral-latest"] });
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "A", credentials: { apiKey: "key-a" }, priority: 0 });
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "B", credentials: { apiKey: "key-b" }, priority: 1 });
      let calls = 0;
      installFetchMock(async () => {
        calls += 1;
        if (calls === 1) return Response.json({ error: { message: "rate limit exceeded" } }, { status: 429 });
        return Response.json(completion("combo survivor"));
      });

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "exec-combo", stream: false, messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      expect((await response.json()).choices[0].message.content).toBe("combo survivor");
      expect(calls).toBe(2);
    } finally {
      instance.close();
    }
  });

  test("codex streaming translates the Responses SSE into OpenAI chunks", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-token" } });
      const sse = [
        "data: " + JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "message" } }),
        "data: " + JSON.stringify({ type: "response.output_text.delta", item_id: "msg", output_index: 0, content_index: 0, delta: "hello " }),
        "data: " + JSON.stringify({ type: "response.output_text.delta", item_id: "msg", output_index: 0, content_index: 0, delta: "executor" }),
        "data: " + JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } } }),
        "data: [DONE]",
      ].join("\n\n");
      installFetchMock(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "codex/gpt-5.6-sol", stream: true, messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const text = await response.text();
      expect(text).toContain("chat.completion.chunk");
      expect(text).toContain("hello ");
      expect(text).toContain("executor");
      expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);

      const summary = instance.repos.usage.summary("/all");
      expect(summary.requests).toBe(1);
      expect(summary.total_tokens).toBe(8);
    } finally {
      instance.close();
    }
  });

  test("cancelling a client stream cancels the upstream stream", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      let upstreamCancelled = false;
      installFetchMock(async () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "cancel-1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }] })}\n\n`));
          },
          cancel() {
            upstreamCancelled = true;
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      });

      const response = await createApp(instance).request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] }) });
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel("client closed");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(upstreamCancelled).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("a stalled upstream stream is cancelled by the raw-byte watchdog", async () => {
    const instance = await createRuntime(loadRuntimeConfig({
      BACKEND_HOST: "127.0.0.1",
      BACKEND_DATABASE_PATH: ":memory:",
      DATA_DIR: `/tmp/lobakai-v2-stall-${crypto.randomUUID()}`,
      REQUIRE_LOGIN: "false",
      STREAM_STALL_TIMEOUT_MS: "10",
    }));
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      let upstreamCancelled = false;
      installFetchMock(async () => new Response(new ReadableStream<Uint8Array>({
        cancel() { upstreamCancelled = true; },
      }), { status: 200, headers: { "content-type": "text/event-stream" } }));

      const response = await createApp(instance).request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] }) });
      const reader = response.body!.getReader();
      await reader.read();

      expect(upstreamCancelled).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("streaming completions estimate and record usage when upstream omits it", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      const chunks = [
        "data: " + JSON.stringify({ id: "estimated-1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: { content: "estimated output" }, finish_reason: null }] }),
        "data: " + JSON.stringify({ id: "estimated-1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]",
      ].join("\n\n");
      installFetchMock(async () => new Response(chunks, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const response = await createApp(instance).request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] }) });
      const text = await response.text();
      expect(text).toContain('"estimated":true');
      expect(instance.repos.usage.summary("/all").total_tokens).toBeGreaterThan(0);
    } finally {
      instance.close();
    }
  });

  test("does not send internal tool-name mappings to Claude upstreams", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "claude", authType: "apikey", credentials: { apiKey: "claude-key" } });
      let upstreamBody: Record<string, unknown> | null = null;
      installFetchMock(async (_input, init) => {
        upstreamBody = JSON.parse(String(init?.body));
        return Response.json({ id: "msg_tool", type: "message", model: "claude-sonnet-4-5", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
      });

      const response = await createApp(instance).request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude/claude-sonnet-4-5", stream: false, messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }] }) });
      expect(response.status).toBe(200);
      expect((upstreamBody as Record<string, unknown> | null)?._toolNameMap).toBeUndefined();
    } finally {
      instance.close();
    }
  });

  test("codex non-streaming buffers the forced SSE and returns a completion", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-token" } });
      const sse = [
        "data: " + JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "buffered answer" }),
        "data: " + JSON.stringify({ type: "response.completed", response: { id: "resp_2", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }),
        "data: [DONE]",
      ].join("\n\n");
      installFetchMock(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "codex/gpt-5.6-sol", stream: false, messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.object).toBe("chat.completion");
      expect(payload.choices[0].message.content).toBe("buffered answer");
      expect(instance.repos.usage.summary("/all").total_tokens).toBe(5);
    } finally {
      instance.close();
    }
  });

  test("codex buffers a headerless Responses SSE into a completion", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-token" } });
      const sse = [
        "event: response.output_text.delta\ndata: " + JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "headerless answer" }),
        "event: response.completed\ndata: " + JSON.stringify({ type: "response.completed", response: { id: "resp_headerless", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }),
      ].join("\n\n");
      installFetchMock(async () => new Response(sse, { status: 200 }));

      const response = await createApp(instance).request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "codex/gpt-5.6-sol", stream: false, messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.choices[0].message.content).toBe("headerless answer");
    } finally {
      instance.close();
    }
  });

  test("Responses passthrough preserves events and synthesizes a terminal failure", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-token" } });
      const sse = "event: response.output_text.delta\ndata: " + JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "partial" }) + "\n\n";
      installFetchMock(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const response = await createApp(instance).request("/v1/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "codex/gpt-5.6-sol", stream: true, input: "hi" }) });
      const text = await response.text();
      expect(text).toContain("event: response.output_text.delta");
      expect(text).toContain("event: response.failed");
      expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("claude clients receive claude-format SSE from an openai executor", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      const chunks = [
        "data: " + JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: { content: "bo" }, finish_reason: null }] }),
        "data: " + JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: { content: "njour" }, finish_reason: null }] }),
        "data: " + JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }),
        "data: [DONE]",
      ].join("\n\n");
      installFetchMock(async () => new Response(chunks, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const app = createApp(instance);
      const response = await app.request("/v1/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: true, max_tokens: 100, messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("event: content_block_delta");
      expect(text).toContain('"text_delta"');
      expect(text).toContain("bo");
      expect(text).toContain("njour");
      expect(text).toContain("event: message_stop");
    } finally {
      instance.close();
    }
  });

  test("ZenMux selects native endpoints and authentication for each client protocol", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "zenmux", authType: "apikey", credentials: { apiKey: "zenmux-key" }, data: { models: ["openai/gpt-5"] } });
      const calls: Array<{ url: string; authorization: string; apiKey: string | null; version: string | null }> = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const headers = new Headers(init?.headers);
        calls.push({ url, authorization: headers.get("authorization") || "", apiKey: headers.get("x-api-key"), version: headers.get("anthropic-version") });
        if (url.endsWith("/messages")) {
          return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "openai/gpt-5", content: [{ type: "text", text: "message" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
        }
        if (url.endsWith("/responses")) {
          return Response.json({ id: "resp_1", object: "response", status: "completed", model: "openai/gpt-5", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "response" }] }], usage: { input_tokens: 1, output_tokens: 1 } });
        }
        return Response.json({ id: "chat_1", object: "chat.completion", model: "openai/gpt-5", choices: [{ index: 0, message: { role: "assistant", content: "chat" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      });
      const app = createApp(instance);
      expect((await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "zenmux/openai/gpt-5", messages: [{ role: "user", content: "hi" }] }) })).status).toBe(200);
      expect((await app.request("/v1/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "zenmux/openai/gpt-5", input: "hi" }) })).status).toBe(200);
      expect((await app.request("/v1/messages", { method: "POST", headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "zenmux/openai/gpt-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }) })).status).toBe(200);
      expect(calls).toEqual([
        { url: "https://zenmux.ai/api/v1/chat/completions", authorization: "Bearer zenmux-key", apiKey: null, version: null },
        { url: "https://zenmux.ai/api/v1/responses", authorization: "Bearer zenmux-key", apiKey: null, version: null },
        { url: "https://zenmux.ai/api/anthropic/v1/messages", authorization: "", apiKey: "zenmux-key", version: "2023-06-01" },
      ]);
    } finally {
      instance.close();
    }
  });
});
