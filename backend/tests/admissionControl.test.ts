import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

const CHAT_URL = "https://api.mistral.ai/v1/chat/completions";
const SEARCH_URL = "https://api.tavily.com/search";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-admission-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

type Instance = Awaited<ReturnType<typeof runtime>>;
type App = ReturnType<typeof createApp>;

type HeldCall = { url: string; release: () => void };

const COMPLETION = {
  id: "chatcmpl-held",
  object: "chat.completion",
  model: "mistral-large-latest",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

// Holds every upstream chat and search call until the test releases it.
// Chat calls answer with a completion (or an SSE stream). Other URLs (for
// example the exit-IP probe) get 404 at once.
function holdUpstream(kind: "json" | "stream" = "json") {
  const calls: HeldCall[] = [];
  const waiters: Array<(call: HeldCall) => void> = [];
  installFetchMock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url !== CHAT_URL && url !== SEARCH_URL) return new Response("not mocked", { status: 404 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const call = { url, release };
    calls.push(call);
    waiters.shift()?.(call);
    if (url === SEARCH_URL) {
      await released;
      return Response.json({ results: [{ title: "Hit", url: "https://example.test/a", content: "body", score: 1 }] });
    }
    if (kind === "json") {
      await released;
      return Response.json(COMPLETION);
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "s1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n\n`));
        await released;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  return {
    calls,
    nextCall: () => new Promise<HeldCall>((resolve) => { waiters.push(resolve); }),
  };
}

function chat(app: App, options: { key?: string; stream?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.key) headers.authorization = `Bearer ${options.key}`;
  return app.request("/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: Boolean(options.stream), messages: [{ role: "user", content: "hi" }] }),
  });
}

function search(app: App) {
  return app.request("/v1/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "tavily", query: "hello" }),
  });
}

async function patchSettings(app: App, patch: Record<string, unknown>) {
  const response = await app.request("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

function addConnection(instance: Instance, name: string, apiKey: string, priority: number) {
  instance.repos.providers.create({ provider: "mistral", authType: "apikey", name, credentials: { apiKey }, priority });
}

describe("global in-flight cap", () => {
  test("cap 2 with two held requests: a third chat or media request gets 503 with Retry-After", async () => {
    const instance = await runtime();
    try {
      addConnection(instance, "A", "key-a", 1);
      instance.repos.providers.create({ provider: "tavily", authType: "apikey", credentials: { apiKey: "tavily-key" } });
      const app = createApp(instance);
      await patchSettings(app, { maxInFlightRequests: 2 });
      const upstream = holdUpstream("json");

      const firstCall = upstream.nextCall();
      const first = chat(app);
      await firstCall;
      const secondCall = upstream.nextCall();
      const second = search(app);
      await secondCall;

      const third = await chat(app);
      expect(third.status).toBe(503);
      expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(JSON.stringify(await third.json())).not.toContain("mistral");
      const thirdMedia = await search(app);
      expect(thirdMedia.status).toBe(503);
      expect(Number(thirdMedia.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(upstream.calls).toHaveLength(2);

      for (const call of upstream.calls) call.release();
      // The slots return when the client has read each response body.
      for (const response of [await first, await second]) {
        expect(response.status).toBe(200);
        await response.text();
      }
      const nextCall = upstream.nextCall();
      const next = chat(app);
      (await nextCall).release();
      expect((await next).status).toBe(200);
    } finally {
      instance.close();
    }
  });
});

describe("per-API-key concurrency limit", () => {
  test("key limit 1 with a held response: the same key gets 429 with Retry-After, another key succeeds", async () => {
    const instance = await runtime();
    try {
      addConnection(instance, "A", "key-a", 1);
      instance.repos.keys.create({ name: "Limited", key: "sk-limited", maxConcurrency: 1, modelAccessMode: "blacklist" });
      instance.repos.keys.create({ name: "Other", key: "sk-other", modelAccessMode: "blacklist" });
      const app = createApp(instance);
      const upstream = holdUpstream("json");

      const heldCall = upstream.nextCall();
      const held = chat(app, { key: "sk-limited" });
      await heldCall;

      const blocked = await chat(app, { key: "sk-limited" });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

      const otherCall = upstream.nextCall();
      const other = chat(app, { key: "sk-other" });
      (await otherCall).release();
      expect((await other).status).toBe(200);
      expect(upstream.calls).toHaveLength(2);

      upstream.calls[0].release();
      const heldResponse = await held;
      expect(heldResponse.status).toBe(200);
      await heldResponse.text();

      // The key slot is free again.
      const againCall = upstream.nextCall();
      const again = chat(app, { key: "sk-limited" });
      (await againCall).release();
      expect((await again).status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("a client disconnect from a held stream returns the key slot", async () => {
    const instance = await runtime();
    try {
      addConnection(instance, "A", "key-a", 1);
      instance.repos.keys.create({ name: "Limited", key: "sk-limited", maxConcurrency: 1, modelAccessMode: "blacklist" });
      const app = createApp(instance);
      const upstream = holdUpstream("stream");

      const streamCall = upstream.nextCall();
      const streamed = await chat(app, { key: "sk-limited", stream: true });
      await streamCall;
      expect(streamed.status).toBe(200);
      expect((await chat(app, { key: "sk-limited" })).status).toBe(429);

      await streamed.body!.cancel();

      const nextCall = upstream.nextCall();
      const next = chat(app, { key: "sk-limited", stream: true });
      (await nextCall).release();
      const response = await next;
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("[DONE]");
    } finally {
      instance.close();
    }
  });
});

describe("Fallback cap", () => {
  test("cap 2 with five failing Connections: the upstream receives exactly two attempts", async () => {
    const instance = await runtime();
    try {
      for (let index = 1; index <= 5; index += 1) addConnection(instance, `C${index}`, `key-${index}`, index);
      const app = createApp(instance);
      await patchSettings(app, { maxFallbackConnections: 2 });
      const attempts: string[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== CHAT_URL) return new Response("not mocked", { status: 404 });
        attempts.push(String((init?.headers as Record<string, string>)?.Authorization));
        return Response.json({ error: { message: "rate limited" } }, { status: 429 });
      });

      const response = await chat(app);
      expect(response.status).toBe(429);
      expect(attempts).toEqual(["Bearer key-1", "Bearer key-2"]);
    } finally {
      instance.close();
    }
  });
});

// Holds every upstream call whose URL starts with `prefix`. Other URLs get
// 404 at once.
function holdPrefix(prefix: string) {
  const calls: Array<() => void> = [];
  const waiters: Array<() => void> = [];
  installFetchMock(async (input: RequestInfo | URL) => {
    if (!String(input).startsWith(prefix)) return new Response("not mocked", { status: 404 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    calls.push(release);
    waiters.shift()?.();
    await released;
    return Response.json(COMPLETION);
  });
  return { calls, nextCall: () => new Promise<void>((resolve) => { waiters.push(resolve); }) };
}

describe("Connection slots on the other chat paths", () => {
  test("legacy gateway path: limit 1 with a held request, a second request gets 503 with Retry-After", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", baseUrl: "https://provider.test", credentials: { apiKey: "key-a" }, data: { models: ["gpt-test"] } });
      // The generic gateway path serves a combo whose member is itself a combo.
      instance.repos.combos.create({ name: "inner", kind: "fallback", models: ["openai/gpt-test"] });
      instance.repos.combos.create({ name: "outer", kind: "fallback", models: ["inner"] });
      const app = createApp(instance);
      await patchSettings(app, { providerStrategies: { openai: { maxInFlightPerConnection: 1 } } });
      const upstream = holdPrefix("https://provider.test");
      const request = () => app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "outer", messages: [{ role: "user", content: "hi" }] }),
      });

      const firstCall = upstream.nextCall();
      const first = request();
      await firstCall;

      const second = await request();
      expect(second.status).toBe(503);
      expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(upstream.calls).toHaveLength(1);

      upstream.calls[0]();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      await firstResponse.text();

      const thirdCall = upstream.nextCall();
      const third = request();
      await thirdCall;
      upstream.calls[1]();
      expect((await third).status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("native Gemini route: limit 1 with a held request, a second request gets 503 with Retry-After", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", baseUrl: "https://provider.test", credentials: { apiKey: "key-a" }, data: { models: ["gpt-test"] } });
      const app = createApp(instance);
      await patchSettings(app, { providerStrategies: { openai: { maxInFlightPerConnection: 1 } } });
      const upstream = holdPrefix("https://provider.test");
      const request = () => app.request("/v1beta/models/openai/gpt-test:generateContent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
      });

      const firstCall = upstream.nextCall();
      const first = request();
      await firstCall;

      const second = await request();
      expect(second.status).toBe(503);
      expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(upstream.calls).toHaveLength(1);

      upstream.calls[0]();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      await firstResponse.text();

      const thirdCall = upstream.nextCall();
      const third = request();
      await thirdCall;
      upstream.calls[1]();
      expect((await third).status).toBe(200);
    } finally {
      instance.close();
    }
  });
});

describe("Media account Fallback loop", () => {
  const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
  const EMBEDDING = { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1] }], model: "text-embedding-3-small", usage: { prompt_tokens: 1, total_tokens: 1 } };
  const embed = (app: App) => app.request("/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hello" }),
  });

  test("limit 1 with a held embeddings request: a second request gets 503 with Retry-After", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", credentials: { apiKey: "oai-key" } });
      const app = createApp(instance);
      await patchSettings(app, { providerStrategies: { openai: { maxInFlightPerConnection: 1 } } });
      const releases: Array<() => void> = [];
      let started!: () => void;
      const firstStarted = new Promise<void>((resolve) => { started = resolve; });
      installFetchMock(async (input: RequestInfo | URL) => {
        if (String(input) !== EMBEDDINGS_URL) return new Response("not mocked", { status: 404 });
        await new Promise<void>((resolve) => { releases.push(resolve); started(); });
        return Response.json(EMBEDDING);
      });

      const first = embed(app);
      await firstStarted;
      const second = await embed(app);
      expect(second.status).toBe(503);
      expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(releases).toHaveLength(1);

      releases[0]();
      expect((await first).status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("cap 2 with three failing Connections: the upstream receives exactly two embeddings attempts", async () => {
    const instance = await runtime();
    try {
      for (let index = 1; index <= 3; index += 1) {
        instance.repos.providers.create({ provider: "openai", authType: "apikey", name: `E${index}`, priority: index, credentials: { apiKey: `emb-${index}` } });
      }
      const app = createApp(instance);
      await patchSettings(app, { maxFallbackConnections: 2 });
      const attempts: string[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== EMBEDDINGS_URL) return new Response("not mocked", { status: 404 });
        attempts.push(String((init?.headers as Record<string, string>)?.Authorization));
        return Response.json({ error: { message: "upstream down" } }, { status: 500 });
      });

      const response = await embed(app);
      expect(response.status).toBe(500);
      expect(attempts).toEqual(["Bearer emb-1", "Bearer emb-2"]);
    } finally {
      instance.close();
    }
  });
});
