import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-chat-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { installFetchMock(null); globalThis.fetch = originalFetch; });

describe("v1 dashboard chat playground routes", () => {
  test("provider catalog exposes the visible v1 media providers", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const response = await app.request("/api/providers/catalog?kind=tts");
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.providers.some((provider: { id: string }) => provider.id === "edge-tts")).toBe(true);
      expect(payload.providers.every((provider: { serviceKinds: string[] }) => provider.serviceKinds.includes("tts"))).toBe(true);
      // Both providers have mediaPriority=5. V1 keeps registry order on a tie.
      expect(payload.providers[0].id).toBe("edge-tts");
    } finally {
      instance.close();
    }
  });

  test("models and accounts endpoints expose the llm catalog and per-provider accounts", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "claude", authType: "oauth", name: "Main", email: "a@b.c", credentials: { accessToken: "token" } });
      instance.repos.combos.create({ name: "chain", models: ["claude/claude-sonnet"] });
      const app = createApp(instance);

      const models = await app.request("/api/dashboard/chat/models");
      const modelsPayload = await models.json();
      expect(modelsPayload.object).toBe("list");
      expect(Array.isArray(modelsPayload.data)).toBe(true);

      const missing = await app.request("/api/dashboard/chat/accounts");
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ error: "Model is required" });

      const combo = await app.request("/api/dashboard/chat/accounts?model=chain");
      expect(await combo.json()).toEqual({ model: "chain", supportsSelection: false, accounts: [] });

      const accounts = await app.request("/api/dashboard/chat/accounts?model=claude/claude-sonnet");
      const accountsPayload = await accounts.json();
      expect(accountsPayload.supportsSelection).toBe(true);
      expect(accountsPayload.provider).toBe("claude");
      expect(accountsPayload.accounts).toEqual([{ id: connection.id, label: "Main", email: "a@b.c", authType: "oauth", priority: 0, isActive: true }]);

      const noAuth = await app.request("/api/dashboard/chat/accounts?model=edge-tts/en-US-AriaNeural");
      const noAuthPayload = await noAuth.json();
      expect(noAuthPayload.supportsSelection).toBe(true);
      expect(noAuthPayload.accounts).toEqual([{ id: "noauth", label: "Public", authType: "none", isActive: true }]);
    } finally {
      instance.close();
    }
  });

  test("completions routes playground traffic through the gateway without an API key", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", baseUrl: "https://upstream.test", credentials: { apiKey: "key" }, data: { models: ["gpt-test"] } });
      installFetchMock(async () => new Response(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        model: "gpt-test",
        choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } }));

      const app = createApp(instance);
      const responses = await app.request("/api/dashboard/chat/completions?format=responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-test", input: "hello" }) });
      expect(responses.status).toBe(200);
      const payload = await responses.json();
      expect(payload.object).toBe("response");
      expect(payload.output_text).toBe("hi there");

      const messages = await app.request("/api/dashboard/chat/completions?format=messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-test", messages: [{ role: "user", content: "hello" }] }) });
      const messagesPayload = await messages.json();
      expect(messagesPayload.type).toBe("message");
      expect(messagesPayload.content).toEqual([{ type: "text", text: "hi there" }]);
    } finally {
      instance.close();
    }
  });

  test("tools endpoint runs sandbox tools and rejects escapes", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const unsupported = await app.request("/api/dashboard/chat/tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "nope" }) });
      expect(unsupported.status).toBe(400);
      expect((await unsupported.json()).error).toContain("Unsupported dashboard tool");

      const escape = await app.request("/api/dashboard/chat/tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "sandbox_read_file", arguments: { path: "../package.json" } }) });
      expect(escape.status).toBe(400);
      expect((await escape.json()).error).toContain("must stay inside the sandbox");

      const write = await app.request("/api/dashboard/chat/tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "sandbox_write_file", arguments: { path: "chat/hello.txt", content: "hello playground" } }) });
      expect(write.status).toBe(200);
      const writePayload = await write.json();
      expect(writePayload.ok).toBe(true);
      expect(writePayload.result.written).toBe(true);

      const read = await app.request("/api/dashboard/chat/tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "sandbox_read_file", arguments: { path: "chat/hello.txt" } }) });
      const readPayload = await read.json();
      expect(readPayload.result.content).toBe("hello playground");

      const list = await app.request("/api/dashboard/chat/tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "mcp__sandbox__list_files", arguments: { path: "chat" } }) });
      const listPayload = await list.json();
      expect(listPayload.result.entries).toEqual([{ name: "hello.txt", type: "file" }]);
    } finally {
      await rm("sandbox", { recursive: true, force: true }).catch(() => {});
      instance.close();
    }
  });

  test("version and shutdown routes keep v1 auth and environment gates", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      globalThis.fetch = (async () => { throw new Error("version lookup must stay offline"); }) as unknown as typeof fetch;
      const version = await app.request("/api/version");
      const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
      expect(await version.json()).toEqual({ currentVersion: pkg.version });

      // v1's ALWAYS_PROTECTED: requireLogin=false must not unlock these.
      const update = await app.request("/api/version/update", { method: "POST" });
      expect(update.status).toBe(404);
      const shutdown = await app.request("/api/version/shutdown", { method: "POST" });
      expect(shutdown.status).toBe(401);
      const devShutdown = await app.request("/api/shutdown", { method: "POST" });
      expect(devShutdown.status).toBe(401);

      const token = await instance.auth.createSession();
      const secretMissing = await app.request("/api/shutdown", { method: "POST", headers: { cookie: `auth_token=${token}` } });
      expect(secretMissing.status).toBe(401);
    } finally {
      delete process.env.SHUTDOWN_SECRET;
      instance.close();
    }
  });
});
