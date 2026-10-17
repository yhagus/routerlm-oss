import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

// A request that waits on a slow Provider must write back only the fields it
// changed. Writes that other actors made during the wait must survive.

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-connection-patch-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => { installFetchMock(null); });

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { open, opened };
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const chatRequest = (model: string, stream: boolean) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, stream, messages: [{ role: "user", content: "hi" }] }),
});

// The generic gateway path serves a combo whose member is itself a combo.
function nestedCombo(instance: Awaited<ReturnType<typeof runtime>>): string {
  instance.repos.combos.create({ name: "inner", kind: "fallback", models: ["openai/gpt-test"] });
  instance.repos.combos.create({ name: "outer", kind: "fallback", models: ["inner"] });
  return "outer";
}

const ERROR_FIELDS = ["rateLimitedUntil", "backoffLevel", "lastError", "lastErrorAt", "testStatus"];

function withoutErrorFields(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !ERROR_FIELDS.includes(key)));
}

describe("gateway path writes only the fields it changed", () => {
  test("a slow stream that ends with success keeps tokens stored during the wait", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "openai", authType: "oauth", baseUrl: "https://provider.test", credentials: { accessToken: "old-access", refreshToken: "old-refresh" }, data: { models: ["gpt-test"] } });
      const upstreamCalled = gate();
      const release = gate();
      let called = false;
      installFetchMock(async () => {
        called = true;
        upstreamCalled.open();
        const encoder = new TextEncoder();
        return new Response(new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode("data: {\"id\":\"c1\",\"choices\":[{\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n"));
            await release.opened;
            controller.enqueue(encoder.encode("data: {\"id\":\"c1\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\n"));
            controller.close();
          },
        }), { headers: { "content-type": "text/event-stream" } });
      });

      const pending = createApp(instance).request("/v1/chat/completions", chatRequest(nestedCombo(instance), true));
      await upstreamCalled.opened;
      expect(called).toBe(true);
      instance.repos.providers.update(connection.id, { data: { accessToken: "new-access", refreshToken: "new-refresh" } });
      release.open();
      const response = await pending;
      expect(response.status).toBe(200);
      await response.text();

      const stored = instance.repos.providers.get(connection.id)!;
      expect(stored.data.accessToken).toBe("new-access");
      expect(stored.data.refreshToken).toBe("new-refresh");
      expect(stored.data.testStatus).toBe("ok");
    } finally {
      instance.close();
    }
  });

  test("a slow stream that ends with success changes only error fields", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "openai", baseUrl: "https://provider.test", credentials: { apiKey: "upstream-key" }, data: { models: ["gpt-test"], modelLock_other: "2000-01-01T00:00:00.000Z" } });
      const upstreamCalled = gate();
      const release = gate();
      installFetchMock(async () => {
        upstreamCalled.open();
        const encoder = new TextEncoder();
        return new Response(new ReadableStream<Uint8Array>({
          async start(controller) {
            await release.opened;
            controller.enqueue(encoder.encode("data: {\"id\":\"c2\",\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\n"));
            controller.close();
          },
        }), { headers: { "content-type": "text/event-stream" } });
      });

      const pending = createApp(instance).request("/v1/chat/completions", chatRequest(nestedCombo(instance), true));
      await upstreamCalled.opened;
      // Another request stores a cooldown and a model lock during the wait.
      instance.repos.providers.update(connection.id, { data: { rateLimitedUntil: "2999-01-01T00:00:00.000Z", backoffLevel: 2, lastError: "rate limited", testStatus: "error", modelLock_other: "2999-01-01T00:00:00.000Z" } });
      const beforeSuccess = instance.repos.providers.get(connection.id)!.data;
      release.open();
      const response = await pending;
      expect(response.status).toBe(200);
      await response.text();

      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(withoutErrorFields(stored)).toEqual(withoutErrorFields(beforeSuccess));
      expect(stored.apiKey).toBe("upstream-key");
      expect(stored.modelLock_other).toBe("2999-01-01T00:00:00.000Z");
      expect(stored.backoffLevel).toBe(0);
      expect(stored.testStatus).toBe("ok");
      expect(stored.rateLimitedUntil ?? null).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("a slow request that ends with an upstream error keeps tokens stored during the wait", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "openai", baseUrl: "https://provider.test", credentials: { apiKey: "old-key", accessToken: "old-access" }, data: { models: ["gpt-test"] } });
      const upstreamCalled = gate();
      const release = gate();
      installFetchMock(async () => {
        upstreamCalled.open();
        await release.opened;
        return Response.json({ error: { message: "upstream exploded" } }, { status: 500 });
      });

      const pending = createApp(instance).request("/v1/chat/completions", chatRequest(nestedCombo(instance), false));
      await upstreamCalled.opened;
      instance.repos.providers.update(connection.id, { data: { apiKey: "new-key", accessToken: "new-access" } });
      release.open();
      const response = await pending;
      expect(response.ok).toBe(false);

      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.apiKey).toBe("new-key");
      expect(stored.accessToken).toBe("new-access");
      expect(stored.testStatus).toBe("error");
      expect(stored.lastError).toBe("upstream exploded");
    } finally {
      instance.close();
    }
  });

  test("a slow request that fails at the network keeps tokens stored during the wait", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "openai", baseUrl: "https://provider.test", credentials: { apiKey: "old-key" }, data: { models: ["gpt-test"] } });
      const upstreamCalled = gate();
      const release = gate();
      installFetchMock(async () => {
        upstreamCalled.open();
        await release.opened;
        throw new Error("socket hang up");
      });

      const pending = createApp(instance).request("/v1/chat/completions", chatRequest(nestedCombo(instance), false));
      await upstreamCalled.opened;
      instance.repos.providers.update(connection.id, { data: { apiKey: "new-key" } });
      release.open();
      const response = await pending;
      expect(response.ok).toBe(false);

      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.apiKey).toBe("new-key");
      expect(stored.lastError).toBe("socket hang up");
      expect(stored.testStatus).toBe("error");
    } finally {
      instance.close();
    }
  });
});

describe("chat path project-id hydration writes only the project id", () => {
  test("a slow project lookup keeps tokens stored during the wait", async () => {
    const instance = await runtime();
    try {
      const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
      const connection = instance.repos.providers.create({ provider: "antigravity", authType: "oauth", credentials: { accessToken: "old-access", refreshToken: "old-refresh", expiresAt } });
      const lookupCalled = gate();
      const release = gate();
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("loadCodeAssist")) {
          lookupCalled.open();
          await release.opened;
          return Response.json({ cloudaicompanionProject: "project-from-lookup" });
        }
        return new Response(
          `data: ${JSON.stringify({ response: { candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } } })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      });

      const pending = createApp(instance).request("/v1/chat/completions", chatRequest("antigravity/gemini-pro-agent", false));
      await lookupCalled.opened;
      instance.repos.providers.update(connection.id, { data: { accessToken: "new-access", refreshToken: "new-refresh" } });
      release.open();
      const response = await pending;
      expect(response.status).toBe(200);
      await response.text();

      await waitFor(() => instance.repos.providers.get(connection.id)?.data.projectId === "project-from-lookup");
      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.accessToken).toBe("new-access");
      expect(stored.refreshToken).toBe("new-refresh");
    } finally {
      instance.close();
    }
  });
});
