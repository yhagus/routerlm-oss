import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { connectionInFlight, slotsInFlight } from "../src/services/chat/inFlightSlots";
import { flushRequestDetails } from "../src/services/chat/requestDetails";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-pull-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

type Instance = Awaited<ReturnType<typeof runtime>>;

const encoder = new TextEncoder();
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function post(instance: Instance, path: string, body: Record<string, unknown>, signal?: AbortSignal) {
  return createApp(instance).request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
}

function sseResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

// Split a client stream into SSE frames (one entry per blank-line-terminated event).
function frames(text: string): string[] {
  return text.split("\n\n").filter(Boolean);
}

async function latestDetail(instance: Instance): Promise<Record<string, any>> {
  flushRequestDetails(instance);
  const list = await (await createApp(instance).request("/api/usage/request-details")).json() as { details: Record<string, any>[] };
  return list.details[0];
}

// A mock Provider body that produces one SSE event per pull and records how
// many pulls it served. highWaterMark 0: it only produces data on demand.
function pulledBody(events: string[]) {
  const stats = { pulls: 0, cancelled: false };
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      stats.pulls += 1;
      if (index >= events.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(events[index++]));
    },
    cancel() { stats.cancelled = true; },
  }, { highWaterMark: 0 });
  return { body, stats };
}

const openAiUpstream = [
  `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`,
  `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\n\n`,
  `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n`,
  `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n`,
  `data: [DONE]\n\n`,
];

describe("chat stream output format", () => {
  test("OpenAI client receives the provider frames, then [DONE]; Usage and request detail are recorded", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      installFetchMock(async () => sseResponse(openAiUpstream.join("")));

      const response = await post(instance, "/v1/chat/completions", { model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] });
      expect(frames(await response.text())).toEqual([
        `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
        `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}`,
        `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}`,
        `data: {"id":"c1","object":"chat.completion.chunk","created":1700000000,"model":"mistral-large-latest","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}`,
        `data: [DONE]`,
      ]);
      expect(instance.repos.usage.summary("/all")).toMatchObject({ requests: 1, prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
      const detail = await latestDetail(instance);
      expect(detail.status).toBe("success");
      expect(detail.response).toEqual({ id: "c1", object: "chat.completion", model: "mistral-large-latest", choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } });
    } finally {
      instance.close();
    }
  });

  test("OpenAI client gets an estimated Usage on the finish frame when the provider omits it", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      installFetchMock(async () => sseResponse([
        `data: {"id":"e1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"twelve chars"},"finish_reason":null}]}\n\n`,
        `data: {"id":"e1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
        `data: [DONE]\n\n`,
      ].join("")));

      const response = await post(instance, "/v1/chat/completions", { model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] });
      // Values pinned from the push-based stream: prompt = request JSON
      // length / 4 + a 2000-token buffer; completion = 12 characters / 4.
      expect(frames(await response.text())).toEqual([
        `data: {"id":"e1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"twelve chars"},"finish_reason":null}]}`,
        `data: {"id":"e1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2025,"completion_tokens":3,"total_tokens":2028,"estimated":true}}`,
        `data: [DONE]`,
      ]);
      expect(instance.repos.usage.summary("/all")).toMatchObject({ requests: 1, prompt_tokens: 2025, completion_tokens: 3 });
    } finally {
      instance.close();
    }
  });

  test("Claude client receives translated Claude events in order", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      installFetchMock(async () => sseResponse(openAiUpstream.join("")));

      const response = await post(instance, "/v1/messages", { model: "mistral/mistral-large-latest", stream: true, max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
      const text = (await response.text()).replace(/"msg_\d+"/, '"msg_ID"');
      expect(frames(text)).toEqual([
        `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_ID","type":"message","role":"assistant","model":"mistral-large-latest","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}`,
        `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}`,
        `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}`,
        `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":2}}`,
        `event: message_stop\ndata: {"type":"message_stop"}`,
      ]);
      expect(instance.repos.usage.summary("/all")).toMatchObject({ requests: 1, prompt_tokens: 5, completion_tokens: 2 });
      const detail = await latestDetail(instance);
      expect(detail.response.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
    } finally {
      instance.close();
    }
  });

  test("Responses client receives provider events, then [DONE]", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-token" } });
      installFetchMock(async () => sseResponse([
        `event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}\n\n`,
        `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Hel"}\n\n`,
        `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"lo"}\n\n`,
        `event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}\n\n`,
      ].join("")));

      const response = await post(instance, "/v1/responses", { model: "codex/gpt-5.6-sol", stream: true, input: "hi" });
      expect(frames(await response.text())).toEqual([
        `event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}`,
        `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Hel"}`,
        `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"lo"}`,
        `event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}`,
        `data: [DONE]`,
      ]);
      expect(instance.repos.usage.summary("/all")).toMatchObject({ requests: 1, prompt_tokens: 5, completion_tokens: 2 });
    } finally {
      instance.close();
    }
  });

  test("Responses client gets response.failed and [DONE] when the provider ends without a terminal event", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-token" } });
      installFetchMock(async () => sseResponse(`event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"partial"}\n\n`));

      const response = await post(instance, "/v1/responses", { model: "codex/gpt-5.6-sol", stream: true, input: "hi" });
      expect(frames(await response.text())).toEqual([
        `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"partial"}`,
        `event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed","error":{"message":"Upstream stream ended without a terminal event"}}}`,
        `data: [DONE]`,
      ]);
    } finally {
      instance.close();
    }
  });
});

describe("chat stream backpressure", () => {
  test("a slow client makes the Provider body be read slowly", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      const events = Array.from({ length: 40 }, (_, i) => `data: {"id":"s1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"t${i} "},"finish_reason":null}]}\n\n`);
      events.push(`data: {"id":"s1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":40,"total_tokens":41}}\n\n`, `data: [DONE]\n\n`);
      const upstream = pulledBody(events);
      installFetchMock(async () => new Response(upstream.body, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const response = await post(instance, "/v1/chat/completions", { model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] });
      const reader = response.body!.getReader();
      await reader.read();
      await tick(30);

      // The client took one frame. Only a few pulls may run ahead of it.
      expect(upstream.stats.pulls).toBeLessThanOrEqual(5);
      expect(connectionInFlight(instance, connection.id)).toBe(1);

      const decoder = new TextDecoder();
      let rest = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value, { stream: true });
      }
      expect(rest.trimEnd().endsWith("data: [DONE]")).toBe(true);
      expect(instance.repos.usage.summary("/all")).toMatchObject({ requests: 1, completion_tokens: 40 });
      expect(connectionInFlight(instance, connection.id)).toBe(0);
      expect(slotsInFlight(instance, "global", "all")).toBe(0);
    } finally {
      instance.close();
    }
  });

  test("a client cancel stops the Provider body and returns every slot", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      const events = Array.from({ length: 40 }, (_, i) => `data: {"id":"x1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"t${i}"},"finish_reason":null}]}\n\n`);
      const upstream = pulledBody(events);
      installFetchMock(async () => new Response(upstream.body, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const response = await post(instance, "/v1/chat/completions", { model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] });
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel("client closed");
      await tick();

      expect(upstream.stats.cancelled).toBe(true);
      expect(connectionInFlight(instance, connection.id)).toBe(0);
      expect(slotsInFlight(instance, "global", "all")).toBe(0);
    } finally {
      instance.close();
    }
  });
});

describe("chat stream translation failure", () => {
  test("a chunk that fails translation returns the slot, stops the Provider body, records an error detail, and errors the stream", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "k" } });
      const events = [
        openAiUpstream[1],
        // A null tool call makes the OpenAI -> Claude translator throw.
        `data: {"id":"c1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"tool_calls":[null]},"finish_reason":null}]}\n\n`,
        ...Array.from({ length: 20 }, (_, i) => `data: {"id":"c1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"t${i}"},"finish_reason":null}]}\n\n`),
      ];
      const upstream = pulledBody(events);
      installFetchMock(async () => new Response(upstream.body, { status: 200, headers: { "content-type": "text/event-stream" } }));

      const response = await post(instance, "/v1/messages", { model: "mistral/mistral-large-latest", stream: true, max_tokens: 50, messages: [{ role: "user", content: "hi" }] });
      expect(response.status).toBe(200);
      const read = await response.text().then(() => "closed", () => "errored");
      await tick();

      expect(read).toBe("errored");
      expect(upstream.stats.cancelled).toBe(true);
      expect(connectionInFlight(instance, connection.id)).toBe(0);
      expect(slotsInFlight(instance, "global", "all")).toBe(0);
      const detail = await latestDetail(instance);
      expect(detail.status).toBe("error");
      expect(String(detail.response.error)).toContain("tc.index");
    } finally {
      instance.close();
    }
  });
});

describe("remote image prefetch", () => {
  test("a client abort during image prefetch aborts the image fetch", async () => {
    const instance = await runtime();
    try {
      // Antigravity needs inline base64 images, so remote URLs are prefetched.
      instance.repos.providers.create({ provider: "antigravity", authType: "oauth", credentials: { accessToken: "ag-access", refreshToken: "ag-refresh", projectId: "project-1", expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
      let imageFetchStarted!: () => void;
      const started = new Promise<void>((resolve) => { imageFetchStarted = resolve; });
      let imageAborted = false;
      installFetchMock(async (input, init) => {
        if (String(input).startsWith("https://8.8.8.8/")) {
          imageFetchStarted();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => { imageAborted = true; reject(new DOMException("aborted", "AbortError")); });
            // Give up without an abort so the test cannot hang on old code.
            setTimeout(() => reject(new Error("image fetch not aborted")), 500);
          });
        }
        return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }] });
      });

      const client = new AbortController();
      const pending = post(instance, "/v1/chat/completions", {
        model: "antigravity/gemini-pro-agent",
        stream: false,
        messages: [{ role: "user", content: [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "https://8.8.8.8/cat.png" } }] }],
      }, client.signal);
      await started;
      client.abort();
      await Promise.resolve(pending).catch(() => null);
      await tick(20);

      expect(imageAborted).toBe(true);
    } finally {
      instance.close();
    }
  });
});
