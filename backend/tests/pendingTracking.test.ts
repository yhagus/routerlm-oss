import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-pending-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

function activeCount(instance: { repos: { usage: { pendingSnapshot(): Map<string, Map<string, number>> } } }): number {
  let total = 0;
  for (const models of instance.repos.usage.pendingSnapshot().values()) {
    for (const count of models.values()) total += count;
  }
  return total;
}

describe("active-traffic pending tracking", () => {
  test("a streaming executor request increments pending mid-flight and clears on completion", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      let releaseStream: () => void;
      const streamHeld = new Promise<void>((resolve) => { releaseStream = resolve; });
      installFetchMock(async () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "p1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] })}\n\n`));
            // Hold the stream open so the request stays in-flight.
            await streamHeld;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "p1", object: "chat.completion.chunk", model: "mistral-large-latest", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      });

      const response = createApp(instance).request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: true, messages: [{ role: "user", content: "hi" }] }) });

      // Give the stream a tick to start and arm the pending entry.
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(activeCount(instance)).toBe(1);

      releaseStream!();
      // The stream is pull-based: the client must read it to the end.
      await (await response).text();
      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(activeCount(instance)).toBe(0);
    } finally {
      instance.close();
    }
  });

  test("a non-streaming executor request leaves no pending entry after completion", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", credentials: { apiKey: "mistral-key" } });
      installFetchMock(async () => new Response(JSON.stringify({
        id: "p2", object: "chat.completion", model: "mistral-large-latest",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } }));

      await createApp(instance).request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: false, messages: [{ role: "user", content: "hi" }] }) });

      expect(activeCount(instance)).toBe(0);
    } finally {
      instance.close();
    }
  });
});