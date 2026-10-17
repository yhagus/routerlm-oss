import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-round-robin-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

type Instance = Awaited<ReturnType<typeof runtime>>;

// Captures the Authorization header of every upstream chat call, in order.
function recordAuthorization(): string[] {
  const seen: string[] = [];
  installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== "https://api.mistral.ai/v1/chat/completions") return new Response("not mocked", { status: 404 });
    seen.push(String((init?.headers as Record<string, string>)?.Authorization));
    return Response.json({
      id: "chatcmpl-rr",
      object: "chat.completion",
      model: "mistral-large-latest",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  });
  return seen;
}

async function sendChats(instance: Instance, count: number): Promise<void> {
  const app = createApp(instance);
  for (let index = 0; index < count; index += 1) {
    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mistral/mistral-large-latest", stream: false, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(response.status).toBe(200);
    await response.text();
  }
}

describe("round-robin Connection selection", () => {
  test("three Connections with sticky limit 2 rotate in priority order and wrap to the first", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 } as any);
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "A", credentials: { apiKey: "key-a" }, priority: 1 });
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "B", credentials: { apiKey: "key-b" }, priority: 2 });
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "C", credentials: { apiKey: "key-c" }, priority: 3 });
      const seen = recordAuthorization();

      await sendChats(instance, 9);

      // Sticky limit 2 over three Connections: A A B B C C, then wrap to A.
      expect(seen).toEqual([
        "Bearer key-a", "Bearer key-a",
        "Bearer key-b", "Bearer key-b",
        "Bearer key-c", "Bearer key-c",
        "Bearer key-a", "Bearer key-a",
        "Bearer key-b",
      ]);
    } finally {
      instance.close();
    }
  });

  test("a Connection in cooldown is skipped and requests rotate across the other two", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 } as any);
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "A", credentials: { apiKey: "key-a" }, priority: 1 });
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "B", credentials: { apiKey: "key-b" }, priority: 2, data: { rateLimitedUntil: new Date(Date.now() + 10 * 60_000).toISOString() } } as any);
      instance.repos.providers.create({ provider: "mistral", authType: "apikey", name: "C", credentials: { apiKey: "key-c" }, priority: 3 });
      const seen = recordAuthorization();

      await sendChats(instance, 8);

      expect(seen).toEqual([
        "Bearer key-a", "Bearer key-a",
        "Bearer key-c", "Bearer key-c",
        "Bearer key-a", "Bearer key-a",
        "Bearer key-c", "Bearer key-c",
      ]);
    } finally {
      instance.close();
    }
  });
});
