import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-media-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

describe("v2 media endpoints", () => {
  test("web search routes through the provider search API and normalizes results", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "tavily", authType: "apikey", credentials: { apiKey: "tavily-key" } });
      const requests: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        return jsonResponse({ results: [{ title: "Result One", url: "https://example.test/a", content: "hello world", score: 0.9 }], answer: "the answer" });
      }) as unknown as typeof fetch;

      const app = createApp(instance);
      const missing = await app.request("/v1/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "tavily" }) });
      expect(missing.status).toBe(400);
      expect((await missing.json()).error.message).toContain("query");

      const unsupported = await app.request("/v1/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "claude", query: "hi" }) });
      expect(unsupported.status).toBe(400);
      expect((await unsupported.json()).error.message).toContain("does not support web search");

      const search = await app.request("/v1/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "tavily", query: "  what is new  ", max_results: 3 }) });
      expect(search.status).toBe(200);
      const payload = await search.json();
      expect(payload.provider).toBe("tavily");
      expect(payload.query).toBe("what is new");
      expect(payload.results[0]).toMatchObject({ title: "Result One", url: "https://example.test/a" });
      expect(String(payload.results[0].snippet)).toContain("hello world");
      expect(requests[0].url).toBe("https://api.tavily.com/search");
      expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tavily-key");
      expect(instance.repos.usage.summary().requests).toBe(1);
    } finally {
      instance.close();
    }
  });

  test("web fetch extracts markdown and blocks SSRF targets", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "firecrawl", authType: "apikey", credentials: { apiKey: "fc-key" } });
      globalThis.fetch = (async () => jsonResponse({ success: true, data: { markdown: "# Page\nbody", metadata: { title: "Page", sourceURL: "https://example.test" } } })) as unknown as typeof fetch;

      const app = createApp(instance);
      const blocked = await app.request("/v1/web/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "firecrawl", url: "http://127.0.0.1:20128/api/settings" }) });
      expect(blocked.status).toBe(400);

      const invalid = await app.request("/v1/web/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "firecrawl", url: "not-a-url" }) });
      expect(invalid.status).toBe(400);

      const fetched = await app.request("/v1/web/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "firecrawl", url: "https://example.test", format: "markdown" }) });
      expect(fetched.status).toBe(200);
      const payload = await fetched.json();
      expect(payload.provider).toBe("firecrawl");
      expect(payload.title).toBe("Page");
      expect(payload.content).toMatchObject({ format: "markdown", text: "# Page\nbody", length: 11 });
    } finally {
      instance.close();
    }
  });

  test("embeddings normalize to the OpenAI list shape and record usage", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", credentials: { apiKey: "oai-key" } });
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/embeddings");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer oai-key");
        return jsonResponse({ object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }], model: "text-embedding-3-small", usage: { prompt_tokens: 7, total_tokens: 7 } });
      }) as unknown as typeof fetch;

      const app = createApp(instance);
      // v1 semantics: a validation 400 still locks the account (checkFallbackError
      // defaults to fallback-eligible), so probe after the successful request.
      const embedded = await app.request("/v1/embeddings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hello" }) });
      expect(embedded.status).toBe(200);
      const payload = await embedded.json();
      expect(payload.object).toBe("list");
      expect(payload.data[0].embedding).toEqual([0.1, 0.2]);
      expect(payload.model).toBe("text-embedding-3-small");
      expect(instance.repos.usage.summary("/all").total_tokens).toBe(7);

      const missing = await app.request("/v1/embeddings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/text-embedding-3-small" }) });
      expect(missing.status).toBe(400);
    } finally {
      instance.close();
    }
  });

  test("speech synthesizes through the elevenlabs adapter in binary and json formats", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "elevenlabs", authType: "apikey", credentials: { apiKey: "el-key" } });
      // The adapter rejects sub-1KB audio as "empty", so synthesize a realistic size.
      const audioBytes = new Uint8Array(2048).map((_, index) => index % 256);
      const requests: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(String(input));
        expect((init?.headers as Record<string, string>)["xi-api-key"]).toBe("el-key");
        return new Response(audioBytes, { status: 200, headers: { "content-type": "audio/mpeg" } });
      }) as unknown as typeof fetch;

      const app = createApp(instance);
      const missing = await app.request("/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "elevenlabs/voice-1" }) });
      expect(missing.status).toBe(400);

      const binary = await app.request("/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "elevenlabs/voice-1", input: "hello world" }) });
      expect(binary.status).toBe(200);
      expect(binary.headers.get("content-type")).toBe("audio/mp3");
      expect(new Uint8Array(await binary.arrayBuffer())).toEqual(audioBytes);
      expect(requests[0]).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-1");

      const asJson = await app.request("/v1/audio/speech?response_format=json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "elevenlabs/voice-1", input: "hello world" }) });
      const jsonPayload = await asJson.json();
      expect(jsonPayload.format).toBe("mp3");
      expect(jsonPayload.audio).toBe(Buffer.from(audioBytes).toString("base64"));
    } finally {
      instance.close();
    }
  });

  test("transcriptions forward multipart through the whisper protocol", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", credentials: { apiKey: "oai-key" } });
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/audio/transcriptions");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer oai-key");
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonResponse({ text: "transcribed words" });
      }) as unknown as typeof fetch;

      const app = createApp(instance);
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "test.wav");
      form.append("model", "whisper-1");
      const transcribed = await app.request("/v1/audio/transcriptions", { method: "POST", body: form });
      expect(transcribed.status).toBe(200);
      expect(await transcribed.json()).toEqual({ text: "transcribed words" });

      const noFile = new FormData();
      noFile.append("model", "whisper-1");
      const missing = await app.request("/v1/audio/transcriptions", { method: "POST", body: noFile });
      expect(missing.status).toBe(400);
    } finally {
      instance.close();
    }
  });

  test("image generations normalize to the OpenAI shape and support binary output", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", credentials: { apiKey: "oai-key" } });
      const pngBase64 = Buffer.from(new Uint8Array([137, 80, 78, 71, 1, 2, 3])).toString("base64");
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://api.openai.com/v1/images/generations");
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("gpt-image-1");
        expect(body.prompt).toBe("a cat");
        return jsonResponse({ created: 1717171717, data: [{ b64_json: pngBase64 }] });
      }) as unknown as typeof fetch;

      const app = createApp(instance);
      const missing = await app.request("/v1/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-image-1" }) });
      expect(missing.status).toBe(400);

      const generated = await app.request("/v1/images/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-image-1", prompt: "a cat" }) });
      expect(generated.status).toBe(200);
      const payload = await generated.json();
      expect(payload.created).toBe(1717171717);
      expect(payload.data[0].b64_json).toBe(pngBase64);

      const binary = await app.request("/v1/images/generations?response_format=binary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-image-1", prompt: "a cat" }) });
      expect(binary.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await binary.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    } finally {
      instance.close();
    }
  });
});
