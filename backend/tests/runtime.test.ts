import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { importLegacyDatabase } from "../src/db/importLegacy";
import { installFetchMock } from "./fetchHarness";

afterEach(() => { installFetchMock(null); });

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: "/tmp/lobakai-v2-tests",
    REQUIRE_LOGIN: "false",
  }));
}

describe("v2 runtime", () => {
  test("runs protected management routes against SQLite", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
       const created = await app.request("/api/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "openai", name: "Local", apiKey: "upstream-key", baseUrl: "http://127.0.0.1:9999" }) });
      expect(created.status).toBe(201);
      const listed = await app.request("/api/providers");
      expect(listed.status).toBe(200);
       expect((await listed.json()).connections[0].provider).toBe("openai");
    } finally {
      instance.close();
    }
  });

  test("matches v1 provider envelopes and omits secrets", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await app.request("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", name: "Primary", apiKey: "secret-key", data: { customFlag: true } }),
      });
      expect(created.status).toBe(201);
      const createdBody = await created.json() as { connection: Record<string, unknown> };
      expect(createdBody.connection.provider).toBe("openai");
      expect(createdBody.connection.apiKey).toBeUndefined();
      expect(createdBody.connection.customFlag).toBe(true);

      const listed = await app.request("/api/providers");
      const listedBody = await listed.json() as { connections: Array<Record<string, unknown>> };
      expect(Array.isArray(listedBody.connections)).toBe(true);
      expect(listedBody.connections[0].apiKey).toBeUndefined();

      const detail = await app.request(`/api/providers/${createdBody.connection.id}`);
      expect(detail.status).toBe(200);
      expect((await detail.json()).connection.apiKey).toBeUndefined();
    } finally {
      instance.close();
    }
  });

  test("exports selected active Qoder Personal Access Tokens as text", async () => {
    const instance = await runtime();
    try {
      const first = instance.repos.providers.create({ provider: "qoder", authType: "oauth", isActive: true, data: { personalAccessToken: "pt-first" } });
      const nested = instance.repos.providers.create({ provider: "qoder", authType: "oauth", isActive: true, data: { providerSpecificData: { personalAccessToken: "pt-nested" } } });
      const inactive = instance.repos.providers.create({ provider: "qoder", authType: "oauth", isActive: false, data: { personalAccessToken: "pt-inactive" } });
      const other = instance.repos.providers.create({ provider: "codex", authType: "oauth", isActive: true, data: { personalAccessToken: "pt-other" } });
      const app = createApp(instance);

      const response = await app.request("/api/providers/export/qoder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionIds: [first.id, nested.id, inactive.id, other.id] }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.text()).split("\n").sort()).toEqual(["pt-first", "pt-nested"]);

      const unavailable = await app.request("/api/providers/export/qoder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionIds: [inactive.id, other.id] }),
      });
      expect(unavailable.status).toBe(400);
      expect((await unavailable.json()).error).toContain("No selected active Qoder connections");
    } finally {
      instance.close();
    }
  });

  test("rejects unknown providers and missing credentials", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const unknown = await app.request("/api/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "not-a-provider" }) });
      expect(unknown.status).toBe(400);
      const missingKey = await app.request("/api/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "openai" }) });
      expect(missingKey.status).toBe(400);
    } finally {
      instance.close();
    }
  });

  test("authenticates a generated API key when enabled", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ requireApiKey: true });
      const app = createApp(instance);
      const created = await app.request("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "test" }) });
      const key = (await created.json()).key as string;
      // v1 canAccessPublicLlmApi: local callers reach model listings without a
      // key; remote callers need one (chat/media additionally enforce
      // requireApiKey at route level, even locally).
      const local = await app.request("/v1/models");
      expect(local.status).toBe(200);
      const unauthorized = await app.request("/v1/models", { headers: { "x-lobak-real-ip": "203.0.113.20", host: "router.example.test" } });
      expect(unauthorized.status).toBe(401);
      const authorized = await app.request("/v1/models", { headers: { authorization: `Bearer ${key}`, "x-lobak-real-ip": "203.0.113.20", host: "router.example.test" } });
      expect(authorized.status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("matches v1 dashboard login behavior without persisting the default password", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const response = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost" },
        body: JSON.stringify({ password: "123456" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);
      expect(response.headers.get("set-cookie")).toContain("auth_token=");
      expect(instance.repos.settings.get().password).toBeUndefined();

      const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
      const protectedResponse = await app.request("/api/providers", { headers: { cookie } });
      expect(protectedResponse.status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("accepts x-goog-api-key and query-string keys for remote gateway requests", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ requireApiKey: true });
      const app = createApp(instance);
      const created = await app.request("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "remote" }) });
      const key = (await created.json()).key as string;
      const headers = { "x-lobak-real-ip": "203.0.113.10", host: "router.example.test" };
      expect((await app.request("/v1/models", { headers })).status).toBe(401);
      expect((await app.request("/v1/models", { headers: { ...headers, "x-goog-api-key": key } })).status).toBe(200);
      expect((await app.request(`/v1/models?key=${encodeURIComponent(key)}`, { headers })).status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("progressively locks failed dashboard logins", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await app.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-lobak-real-ip": "198.51.100.20" },
          body: JSON.stringify({ password: "wrong" }),
        });
        expect(response.status).toBe(401);
      }
      const locked = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-lobak-real-ip": "198.51.100.20" },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(locked.status).toBe(429);
      expect(locked.headers.get("retry-after")).toBeTruthy();
    } finally {
      instance.close();
    }
  });

  test("creates machine-bound API keys and only returns the raw key once", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "machine key", prefix: "router" }),
      });
      expect(created.status).toBe(201);
      const body = await created.json() as { key: string; id: string };
      expect(body.key).toMatch(/^router-[a-f0-9]{16}-[a-z0-9]{6}-[a-f0-9]{8}$/);

      const listed = await app.request("/api/keys");
      const listedBody = await listed.json() as { keys: Array<Record<string, unknown>> };
      expect(Array.isArray(listedBody.keys)).toBe(true);
      expect(listedBody.keys[0].key).toBe(body.key);

      const detail = await app.request(`/api/keys/${body.id}/secret`);
      expect(detail.status).toBe(200);
      expect((await detail.json()).key).toBe(body.key);
    } finally {
      instance.close();
    }
  });

  test("normalizes API-key permissions and prevents private defaults", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await app.request("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "private", visibility: "private", isDefault: true, limitMode: "requests", limitValue: 12 }),
      });
      const body = await created.json() as Record<string, unknown>;
      expect(body.isDefault).toBe(false);
      expect(body.limitMode).toBe("requests");
      expect(body.limitValue).toBe(12);
    } finally {
      instance.close();
    }
  });

  test("matches model management envelopes and persists aliases, custom models, disabled models, and context windows", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const custom = await app.request("/api/models/custom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerAlias: "openai", id: "custom-model", name: "Custom Model" }),
      });
      expect(custom.status).toBe(201);
      expect((await custom.json()).success).toBe(true);

      const customList = await app.request("/api/models/custom");
      expect((await customList.json()).models[0].id).toBe("custom-model");

      const alias = await app.request("/api/models/alias", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openai/custom-model", alias: "friendly" }),
      });
      expect(alias.status).toBe(200);
      expect((await alias.json()).success).toBe(true);
      expect((await (await app.request("/api/models/alias")).json()).aliases.friendly).toBe("openai/custom-model");

      const disabled = await app.request("/api/models/disabled", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerAlias: "openai", ids: ["gpt-5"] }),
      });
      expect(disabled.status).toBe(200);
      expect((await (await app.request("/api/models/disabled?providerAlias=openai")).json()).ids).toContain("gpt-5");

      const context = await app.request("/api/models/context-window", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", model: "gpt-5", contextWindow: 100000 }),
      });
      expect(context.status).toBe(200);
      expect((await (await app.request("/api/models/context-window?provider=openai")).json()).overrides["gpt-5"]).toBe(100000);

      const managed = await app.request("/api/models");
      expect((await managed.json()).models.some((model: Record<string, unknown>) => model.model === "custom-model")).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("public models expose combos and enforce API-key combo access", async () => {
    const instance = await runtime();
    try {
      const combo = instance.repos.combos.create({ name: "primary", models: ["openai/gpt-5"] });
      const app = createApp(instance);
      const local = await app.request("/v1/models");
      expect((await local.json()).data.some((model: Record<string, unknown>) => model.id === "primary")).toBe(true);

      const created = await app.request("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "restricted" }) });
      const key = (await created.json()).key as string;
      const keyRow = instance.repos.keys.list().find((row) => row.name === "restricted");
      expect(keyRow).toBeTruthy();
      instance.repos.keys.update(keyRow!.id, { comboAccessMode: "whitelist", comboAccessList: ["other"] });
      const remote = await app.request("/v1/models", { headers: { authorization: `Bearer ${key}`, "x-lobak-real-ip": "203.0.113.20", host: "router.example.test" } });
      expect((await remote.json()).data.some((model: Record<string, unknown>) => model.id === "primary")).toBe(false);
      void combo;
    } finally {
      instance.close();
    }
  });

  test("exports and imports the complete database contract", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ requireLogin: false, apiKeyPrefix: "router-" });
      instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Primary", credentials: { apiKey: "secret" }, data: { defaultModel: "gpt-5", customFlag: true } });
      instance.repos.nodes.create({ id: "node-1", type: "openai", name: "Node", baseUrl: "https://node.test" });
      instance.repos.proxies.create({ id: "proxy-1", name: "Proxy", proxyUrl: "http://proxy.test" });
      instance.repos.keys.create({ id: "key-1", key: "sk-roundtrip", name: "Roundtrip", visibility: "public", isDefault: true });
      instance.repos.combos.create({ id: "combo-1", name: "primary", models: ["openai/gpt-5"] });
      instance.repos.aliases.set("friendly", "openai/gpt-5");
      instance.repos.models.upsert({ providerAlias: "openai", id: "custom-model", type: "llm", name: "Custom" });
      instance.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('mitmAlias', ?, ?)").run("tool", JSON.stringify({ alias: "value" }));
      instance.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('pricing', ?, ?)").run("openai", JSON.stringify({ "gpt-5": { input: 1 } }));
      instance.sqlite.query("INSERT INTO kv(scope, key, value) VALUES ('modelContextWindows', ?, ?)").run("openai/gpt-5", JSON.stringify(100000));

      const app = createApp(instance);
      const exported = await app.request("/api/settings/database");
      expect(exported.status).toBe(200);
      const payload = await exported.json() as Record<string, any>;
      expect(payload.providerConnections).toHaveLength(1);
      expect(payload.providerNodes).toHaveLength(1);
      expect(payload.proxyPools).toHaveLength(1);
      expect(payload.apiKeys).toHaveLength(1);
      expect(payload.combos).toHaveLength(1);
      expect(payload.modelAliases.friendly).toBe("openai/gpt-5");
      expect(payload.customModels).toHaveLength(1);
      expect(payload.mitmAlias.tool.alias).toBe("value");
      expect(payload.pricing.openai["gpt-5"].input).toBe(1);
      expect(payload.modelContextWindows["openai/gpt-5"]).toBe(100000);

      instance.sqlite.query("DELETE FROM providerConnections").run();
      instance.sqlite.query("DELETE FROM providerNodes").run();
      instance.sqlite.query("DELETE FROM proxyPools").run();
      const imported = await app.request("/api/settings/database", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      expect(imported.status).toBe(200);
      expect((await imported.json()).success).toBe(true);
      const restored = await (await app.request("/api/settings/database")).json() as Record<string, any>;
      expect(restored.providerConnections).toHaveLength(1);
      expect(restored.providerNodes).toHaveLength(1);
      expect(restored.proxyPools).toHaveLength(1);
      expect(restored.modelAliases.friendly).toBe("openai/gpt-5");
      expect(restored.modelContextWindows["openai/gpt-5"]).toBe(100000);
    } finally {
      instance.close();
    }
  });

  test("uses provider credentials for model discovery and persists the live catalog", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      const created = instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Live", baseUrl: "https://models.test/v1", credentials: { apiKey: "provider-secret" } });
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        // v1's openai connection test probes api.openai.com/v1/models with the stored key.
        if (String(input).endsWith("api.openai.com/v1/models")) {
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer provider-secret");
          return Response.json({ data: [{ id: "gpt-test" }] });
        }
        expect(String(input)).toBe("https://models.test/v1/models");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer provider-secret");
        return Response.json({ data: [{ id: "live-one", object: "model" }, { id: "live-two", name: "Live Two" }] });
      });
      const app = createApp(instance);
      const models = await app.request(`/api/providers/${created.id}/models`);
      expect(models.status).toBe(200);
      expect((await models.json()).data.map((model: Record<string, unknown>) => model.id)).toEqual(["live-one", "live-two"]);
      expect(instance.repos.providers.get(created.id)?.data.models).toEqual(["live-one", "live-two"]);

      const tested = await app.request(`/api/providers/${created.id}/test`, { method: "POST" });
      expect(tested.status).toBe(200);
      expect((await tested.json()).valid).toBe(true);
      expect(instance.repos.providers.get(created.id)?.data.testStatus).toBe("active");
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("returns static models and diagnostics when provider discovery fails", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      const created = instance.repos.providers.create({ provider: "openai", authType: "apikey", name: "Offline", baseUrl: "https://offline.test/v1", credentials: { apiKey: "provider-secret" } });
      globalThis.fetch = (async () => Response.json({ error: "offline" }, { status: 503 })) as unknown as typeof fetch;
      const app = createApp(instance);
      const models = await app.request(`/api/providers/${created.id}/models`);
      expect(models.status).toBe(200);
      expect((await models.json()).data.length).toBeGreaterThan(0);
      const tested = await app.request(`/api/providers/${created.id}/test`, { method: "POST" });
      expect((await tested.json()).valid).toBe(false);
      expect(instance.repos.providers.get(created.id)?.data.testStatus).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("routes an OpenAI-compatible request and records usage", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      instance.repos.providers.create({ provider: "openai", baseUrl: "https://provider.test", credentials: { apiKey: "upstream-key" }, data: { models: ["gpt-test"] } });
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://provider.test/v1/chat/completions");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer upstream-key");
        return Response.json({ id: "chat-1", model: "gpt-test", choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
      });
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-test", messages: [{ role: "user", content: "hi" }] }) });
      expect(response.status).toBe(200);
      expect((await response.json()).choices[0].message.content).toBe("hello");
      expect(instance.repos.usage.summary().requests).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("streams OpenAI chunks, preserves DONE, and records streamed usage", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      instance.repos.providers.create({ provider: "openai", baseUrl: "https://provider.test", credentials: { apiKey: "upstream-key" }, data: { models: ["gpt-test"] } });
      installFetchMock(async () => new Response(
        "data: {\"id\":\"chat-1\",\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n" +
        "data: {\"id\":\"chat-1\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3,\"total_tokens\":5}}\n\n" +
        "data: [DONE]", { headers: { "content-type": "text/event-stream" } }));
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-test", stream: true, messages: [{ role: "user", content: "hi" }] }) });
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(text).toContain('"content":"hello"');
      expect(text).toContain("data: [DONE]");
      expect(instance.repos.usage.summary().requests).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("translates an Anthropic stream to OpenAI chunks", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      instance.repos.providers.create({ provider: "anthropic", apiType: "anthropic", baseUrl: "https://provider.test", credentials: { apiKey: "anthropic-key" }, data: { models: ["claude-test"] } });
      installFetchMock(async (_input, init) => {
        expect(new Headers(init?.headers).get("x-api-key")).toBe("anthropic-key");
        return new Response(
          "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg-1\",\"model\":\"claude-test\",\"usage\":{\"input_tokens\":1}}}\n\n" +
          "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n" +
          "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n" +
          "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\n" +
          "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      });
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "anthropic/claude-test", stream: true, messages: [{ role: "user", content: "hi" }] }) });
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(text).toContain('"content":"hi"');
      expect(text).toContain("data: [DONE]");
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("rotates to the next account and skips the cooled-down account", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      const first = instance.repos.providers.create({ provider: "openai", baseUrl: "https://first.test", priority: 1, credentials: { apiKey: "first-key" }, data: { models: ["gpt-test"] } });
      const second = instance.repos.providers.create({ provider: "openai", baseUrl: "https://second.test", priority: 2, credentials: { apiKey: "second-key" }, data: { models: ["gpt-test"] } });
      const calls: string[] = [];
      installFetchMock(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).startsWith("https://first.test")) return Response.json({ error: { message: "rate limit" } }, { status: 429 });
        return Response.json({ id: "chat-2", model: "gpt-test", choices: [{ message: { role: "assistant", content: "fallback" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      });
      const app = createApp(instance);
      const request = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-test", messages: [{ role: "user", content: "hi" }] }) };
      expect((await (await app.request("/v1/chat/completions", request)).json()).choices[0].message.content).toBe("fallback");
      expect(calls).toEqual(["https://first.test/v1/chat/completions", "https://second.test/v1/chat/completions"]);
      expect(instance.repos.providers.get(first.id)?.data.backoffLevel).toBe(1);

      calls.length = 0;
      expect((await (await app.request("/v1/chat/completions", request)).json()).choices[0].message.content).toBe("fallback");
      expect(calls).toEqual(["https://second.test/v1/chat/completions"]);
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("falls through combo candidates after the root retry budget is exhausted", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      instance.repos.providers.create({ provider: "openai", baseUrl: "https://primary.test", credentials: { apiKey: "primary" }, data: { models: ["first"] } });
      instance.repos.providers.create({ provider: "deepseek", baseUrl: "https://fallback.test", credentials: { apiKey: "fallback" }, data: { models: ["second"] } });
      instance.repos.combos.create({ name: "stack", kind: "fallback", models: ["openai/first", "deepseek/second"] });
      const calls: string[] = [];
      installFetchMock(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).startsWith("https://primary.test")) return Response.json({ error: "failed" }, { status: 503 });
        return Response.json({ id: "chat-3", model: "second", choices: [{ message: { role: "assistant", content: "combo fallback" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      });
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "stack", stream: false, messages: [{ role: "user", content: "hi" }] }) });
      expect((await response.json()).choices[0].message.content).toBe("combo fallback");
      expect(calls).toEqual([
        "https://primary.test/v1/chat/completions",
        "https://primary.test/v1/chat/completions",
        "https://primary.test/v1/chat/completions",
        "https://primary.test/v1/chat/completions",
        "https://fallback.test/v1/chat/completions",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  }, 15_000);

  test("refreshes an expired OAuth credential on 401 and retries with the new token", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      const connection = instance.repos.providers.create({ provider: "claude", authType: "oauth", baseUrl: "https://api.test/v1", credentials: { accessToken: "expired", refreshToken: "refresh-me", expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
      const calls: Array<{ url: string; authorization: string | null }> = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({ url, authorization: headers.get("authorization") });
        if (url.includes("/oauth/token")) return Response.json({ access_token: "fresh-token", refresh_token: "fresh-refresh", expires_in: 86_400 });
        if (headers.get("authorization") === "Bearer expired") return Response.json({ error: "expired" }, { status: 401 });
        return Response.json({ id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: "refreshed" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
      });
      const app = createApp(instance);
      const response = await app.request("/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude/claude-sonnet-5", messages: [{ role: "user", content: "hi" }] }) });
      expect((await response.json()).choices[0].message.content).toBe("refreshed");
      expect(calls.filter((call) => !call.url.includes("webshare.io")).map((call) => [call.url, call.authorization])).toEqual([
        ["https://api.test/v1/messages", "Bearer expired"],
        ["https://api.anthropic.com/v1/oauth/token", null],
        ["https://api.test/v1/messages", "Bearer fresh-token"],
      ]);
      expect(instance.repos.providers.get(connection.id)?.data.accessToken).toBe("fresh-token");
      expect(instance.repos.providers.get(connection.id)?.data.refreshToken).toBe("fresh-refresh");
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });
});

describe("legacy importer", () => {
  test("imports core records idempotently", async () => {
    const sourcePath = `/tmp/lobakai-v2-legacy-${crypto.randomUUID()}.sqlite`;
    const source = new Database(sourcePath);
    source.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY, data TEXT); CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT, authType TEXT, name TEXT, email TEXT, priority INTEGER, isActive INTEGER, data TEXT, createdAt TEXT, updatedAt TEXT); CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT, name TEXT, isActive INTEGER, visibility TEXT, createdAt TEXT);`);
    source.query("INSERT INTO settings VALUES (1, ?)").run(JSON.stringify({ requireLogin: false }));
    source.query("INSERT INTO providerConnections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("p1", "openai", "api_key", "Test", null, 0, 1, JSON.stringify({ apiKey: "secret" }), new Date().toISOString(), new Date().toISOString());
    source.query("INSERT INTO apiKeys VALUES (?, ?, ?, ?, ?, ?)").run("k1", "sk-test", "Test", 1, "private", new Date().toISOString());
    source.close();
    const instance = await runtime();
    try {
      const first = await importLegacyDatabase(sourcePath, instance.sqlite);
      instance.repos.settings.invalidateCache();
      instance.repos.providers.invalidateCache();
      instance.repos.keys.invalidateCache();
      const second = await importLegacyDatabase(sourcePath, instance.sqlite);
      expect(first.imported.providerConnections).toBe(1);
      expect(second.imported.providerConnections).toBe(1);
      expect(instance.repos.providers.list(true)).toHaveLength(1);
      expect(instance.repos.keys.list()).toHaveLength(1);
      expect(instance.repos.settings.get().requireLogin).toBe(false);
    } finally {
      instance.close();
      new Database(sourcePath).close();
    }
  });
});
