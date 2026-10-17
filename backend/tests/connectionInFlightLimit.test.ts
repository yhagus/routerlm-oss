import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

const CHAT_URL = "https://api.mistral.ai/v1/chat/completions";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-inflight-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

type Instance = Awaited<ReturnType<typeof runtime>>;
type App = ReturnType<typeof createApp>;

// One upstream chat call the test controls. The mock answers only when the
// test calls `release`, so the request stays in flight until then.
type HeldCall = { authorization: string; release: () => void };

// Holds every upstream chat call and lets the test wait for the next one.
function holdUpstream(kind: "json" | "stream") {
  const calls: HeldCall[] = [];
  const waiters: Array<(call: HeldCall) => void> = [];
  installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== CHAT_URL) return new Response("not mocked", { status: 404 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const call = { authorization: String((init?.headers as Record<string, string>)?.Authorization), release };
    calls.push(call);
    waiters.shift()?.(call);
    if (kind === "json") {
      await released;
      return Response.json({
        id: "chatcmpl-held",
        object: "chat.completion",
        model: "mistral-large-latest",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
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

function chat(app: App, stream = false) {
  return app.request("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mistral/mistral-large-latest", stream, messages: [{ role: "user", content: "hi" }] }),
  });
}

async function setLimit(app: App, limit: number) {
  const response = await app.request("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerStrategies: { mistral: { maxInFlightPerConnection: limit } } }),
  });
  expect(response.status).toBe(200);
}

function addConnection(instance: Instance, name: string, apiKey: string, priority: number) {
  instance.repos.providers.create({ provider: "mistral", authType: "apikey", name, credentials: { apiKey }, priority });
}

describe("per-Connection in-flight limit", () => {
  test("limit 1 with two Connections: request 2 goes to the second Connection and request 3 gets 503 with Retry-After", async () => {
    const instance = await runtime();
    try {
      addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      const app = createApp(instance);
      await setLimit(app, 1);
      const upstream = holdUpstream("json");

      const firstCall = upstream.nextCall();
      const first = chat(app);
      expect((await firstCall).authorization).toBe("Bearer key-a");

      const secondCall = upstream.nextCall();
      const second = chat(app);
      expect((await secondCall).authorization).toBe("Bearer key-b");

      const third = await chat(app);
      expect(third.status).toBe(503);
      expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
      const body = await third.json() as { error: { message: string } };
      expect(JSON.stringify(body)).not.toContain("mistral");
      expect(upstream.calls).toHaveLength(2);

      for (const call of upstream.calls) call.release();
      expect((await first).status).toBe(200);
      expect((await second).status).toBe(200);

      // Both slots are free again: the next request reaches the upstream.
      const fourthCall = upstream.nextCall();
      const fourth = chat(app);
      (await fourthCall).release();
      expect((await fourth).status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("after the client aborts a held stream, a new request gets that slot", async () => {
    const instance = await runtime();
    try {
      addConnection(instance, "A", "key-a", 1);
      const app = createApp(instance);
      await setLimit(app, 1);
      const upstream = holdUpstream("stream");

      const streamCall = upstream.nextCall();
      const streamed = await chat(app, true);
      await streamCall;
      expect(streamed.status).toBe(200);

      // The held stream occupies the only slot.
      expect((await chat(app)).status).toBe(503);

      // Client disconnect: the client cancels the response body.
      await streamed.body!.cancel();

      const nextCall = upstream.nextCall();
      const next = chat(app);
      const call = await nextCall;
      expect(call.authorization).toBe("Bearer key-a");
      call.release();
      expect((await next).status).toBe(200);
      expect(upstream.calls).toHaveLength(2);
    } finally {
      instance.close();
    }
  });

  test("without a limit, concurrent requests share one Connection", async () => {
    const instance = await runtime();
    try {
      addConnection(instance, "A", "key-a", 1);
      addConnection(instance, "B", "key-b", 2);
      const app = createApp(instance);
      const upstream = holdUpstream("json");

      const pending = [];
      for (let index = 0; index < 3; index += 1) {
        const call = upstream.nextCall();
        pending.push(chat(app));
        await call;
      }
      expect(upstream.calls.map((call) => call.authorization)).toEqual(["Bearer key-a", "Bearer key-a", "Bearer key-a"]);
      for (const call of upstream.calls) call.release();
      for (const response of await Promise.all(pending)) expect(response.status).toBe(200);
    } finally {
      instance.close();
    }
  });
});
