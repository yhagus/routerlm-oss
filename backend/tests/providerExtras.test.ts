import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-providers-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { installFetchMock(null); globalThis.fetch = originalFetch; });

describe("v1 provider/model extra routes", () => {
  test("DeepSeek Harness connection probe sends Platform identity headers", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "deepseek-harness", authType: "oauth", credentials: { accessToken: "fixture-token" } });
      installFetchMock(async (input, init) => {
        expect(String(input)).toBe("https://platform.deepseek.com/api/v0/users/get_user_summary");
        const headers = new Headers(init?.headers);
        const complete = headers.get("x-dsh-auth-token") === "fixture-token"
          && headers.get("x-client-bundle-id") === ""
          && headers.get("x-client-platform") === "web"
          && headers.has("x-client-version")
          && headers.get("x-client-locale") === "en_US"
          && headers.has("x-client-timezone-offset");
        return complete
          ? Response.json({ code: 0, data: { biz_code: 0, biz_data: { id: "fixture-user" } } })
          : new Response("Access denied", { status: 403 });
      });
      const response = await createApp(instance).request(`/api/providers/${connection.id}/test`, { method: "POST" });
      expect(await response.json()).toMatchObject({ valid: true, error: null });
    } finally { instance.close(); }
  });

  test("export alims-api-keys returns one active API key per line", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Key One", credentials: { apiKey: "sk-one" } });
      instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Key Two", credentials: { apiKey: "sk-two" } });
      // Inactive connections are skipped.
      instance.repos.providers.create({ provider: "alims-intl", authType: "apikey", name: "Paused", isActive: false, credentials: { apiKey: "sk-paused" } });
      const app = createApp(instance);

      const exportResponse = await app.request("/api/providers/export/alims-api-keys", { method: "POST" });
      expect(exportResponse.status).toBe(200);
      expect(exportResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(await exportResponse.text()).toBe("sk-one\nsk-two");

      // The connection listing never exposes credentials.
      const listing = await (await app.request("/api/providers")).json();
      const allAlims = listing.connections.filter((connection: { provider: string }) => connection.provider === "alims-intl");
      expect(allAlims).toHaveLength(3);
      for (const connection of allAlims) {
        expect(connection.credentials).toEqual({});
        expect(JSON.stringify(connection)).not.toContain("sk-");
      }
    } finally {
      instance.close();
    }
  });

  test("client provider list filters usage-eligible connections and redacts secrets", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "claude",
        authType: "oauth",
        name: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-token-like",
        email: "user@example.test",
        baseUrl: "https://upstream.test",
        credentials: { accessToken: "secret-access-token", refreshToken: "secret-refresh-token" },
        data: { group: "Production", expiresAt: "2027-01-01T00:00:00.000Z", testStatus: "ok" },
      });
      instance.repos.providers.create({ provider: "glm", authType: "apikey", credentials: { apiKey: "secret-key" }, data: { group: "Ops" } });
      instance.repos.providers.create({ provider: "openai", authType: "apikey", credentials: { apiKey: "secret-key" } });

      const app = createApp(instance);
      const response = await app.request("/api/providers/client?provider=claude");
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.providerOptions).toEqual(["claude", "glm"]);
      expect(payload.totals).toEqual({ eligibleConnections: 2, providerFilteredConnections: 1 });
      expect(payload.pagination).toEqual({ page: 1, pageSize: 100, total: 1, totalPages: 1 });
      expect(payload.connections).toHaveLength(1);
      const connection = payload.connections[0];
      expect(connection.provider).toBe("claude");
      expect(connection.group).toBe("Production");
      expect(connection.expiresAt).toBe("2027-01-01T00:00:00.000Z");
      // v1 masks long token-like names down to a short prefix.
      expect(connection.name).toBe("aaaaaaaa***");
      expect(connection.accessToken).toBeUndefined();
      expect(connection.refreshToken).toBeUndefined();
      expect(connection.providerSpecificData.baseUrl).toBe("https://upstream.test");

      const inactive = await app.request("/api/providers/client?accountStatus=inactive");
      expect((await inactive.json()).totals).toEqual({ eligibleConnections: 2, providerFilteredConnections: 2 });
    } finally {
      instance.close();
    }
  });

  test("test-models resolves connection, warms up, and reports per-model results", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const missing = await app.request("/api/providers/missing/test-models", { method: "POST" });
      expect(missing.status).toBe(404);

      const created = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "token" } });
      installFetchMock(async () => Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model: "claude-sonnet-4-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      const response = await app.request(`/api/providers/${created.id}/test-models`, { method: "POST" });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.provider).toBe("claude");
      expect(payload.connectionId).toBe(created.id);
      expect(payload.results.length).toBeGreaterThan(0);
      expect(payload.results[0].modelId).toBeTruthy();
      expect(payload.results[0].ok).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("batch testing validates provider mode, selects free OAuth providers, and returns diagnosis fields", async () => {
    const instance = await runtime();
    try {
      const free = instance.repos.providers.create({ provider: "opencode", authType: "oauth" });
      instance.repos.providers.create({ provider: "claude", authType: "oauth" });
      const app = createApp(instance);

      const missingProvider = await app.request("/api/providers/test-batch", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "provider" }),
      });
      expect(missingProvider.status).toBe(400);
      expect(await missingProvider.json()).toEqual({ error: "providerId is required when mode is provider" });

      const response = await app.request("/api/providers/test-batch", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "free" }),
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.summary).toEqual({ total: 1, passed: 0, failed: 1 });
      expect(payload.results[0]).toMatchObject({ connectionId: free.id, provider: "opencode", authType: "oauth" });
    } finally {
      instance.close();
    }
  });

  test("models test endpoint validates input and reports gateway failures", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const invalid = await app.request("/api/models/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "Model required" });

      const ping = await app.request("/api/models/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "claude/sonnet", kind: "llm" }) });
      expect(ping.status).toBe(200);
      const payload = await ping.json();
      expect(payload.ok).toBe(false);
      // No available account maps to generic 503 without naming the provider.
      expect(payload.status).toBe(503);
      expect(String(payload.error)).not.toContain("claude");
    } finally {
      instance.close();
    }
  });

  test("models test resolves a dashboard provider alias through the default executor", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "token" } });
      const calls: string[] = [];
      installFetchMock(async (input) => {
        calls.push(String(input));
        return Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      });
      const app = createApp(instance);

      const response = await app.request("/api/models/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "cc/claude-sonnet-4-5", kind: "llm" }),
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({ ok: true, status: 200, error: null });
      expect(calls).toEqual(["https://api.anthropic.com/v1/messages?beta=true"]);
    } finally {
      instance.close();
    }
  });

  test("models test accepts a headerless Responses SSE completion", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "codex-token" } });
      const sse = [
        "data: " + JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "model probe" }),
        "data: " + JSON.stringify({ type: "response.completed", response: { id: "resp_probe", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }),
      ].join("\n\n");
      installFetchMock(async () => new Response(sse, { status: 200 }));

      const response = await createApp(instance).request("/api/models/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "cx/gpt-5.6-sol", kind: "llm" }) });
      expect(await response.json()).toMatchObject({ ok: true, status: 200, error: null });
    } finally {
      instance.close();
    }
  });

  test("models test surfaces the upstream error code instead of a generic 500", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "opencode", authType: "none" });
      installFetchMock(async () => new Response(
        JSON.stringify({ type: "error", error: { type: "error", message: "Internal server error" } }),
        { status: 500, headers: { "content-type": "application/json" } },
      ));
      const app = createApp(instance);
      const response = await app.request("/api/models/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "oc/mimo-v2.5-free", kind: "llm" }) });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(false);
      expect(payload.status).toBe(500);
      expect(String(payload.error)).toContain("Internal server error");
    } finally {
      instance.close();
    }
  });

  test("models test maps probe transport failures to 502, not 500", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", credentials: { apiKey: "sk-test" } });
      installFetchMock(async () => { throw new TypeError("fetch failed"); });
      const app = createApp(instance);
      const response = await app.request("/api/models/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "openai/whisper-1", kind: "stt" }) });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({ ok: false, status: 502 });
      expect(String(payload.error)).toContain("fetch failed");
    } finally {
      instance.close();
    }
  });

  test("test-models reports per-model upstream codes without a batch 500", async () => {
    const instance = await runtime();
    try {
      const created = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "token" } });
      installFetchMock(async () => new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Bad request" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ));
      const app = createApp(instance);
      const response = await app.request(`/api/providers/${created.id}/test-models`, { method: "POST" });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.results.length).toBeGreaterThan(0);
      for (const result of payload.results) {
        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
      }
    } finally {
      instance.close();
    }
  });

  test("model availability reports locks and clears cooldowns like v1", async () => {
    const instance = await runtime();
    try {
      const until = new Date(Date.now() + 60_000).toISOString();
      const locked = instance.repos.providers.create({
        provider: "claude",
        authType: "oauth",
        credentials: { accessToken: "token" },
        data: { "modelLock_claude-sonnet": until, testStatus: "unavailable", lastError: "rate limited" },
      });
      const app = createApp(instance);

      const availability = await app.request("/api/models/availability");
      const payload = await availability.json();
      expect(payload.unavailableCount).toBe(1);
      expect(payload.models[0]).toEqual({
        provider: "claude",
        model: "claude-sonnet",
        status: "cooldown",
        until,
        connectionId: locked.id,
        connectionName: locked.id,
        lastError: "rate limited",
      });

      const invalid = await app.request("/api/models/availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "clearCooldown" }) });
      expect(invalid.status).toBe(400);

      const cleared = await app.request("/api/models/availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "clearCooldown", provider: "claude", model: "claude-sonnet" }) });
      expect(await cleared.json()).toEqual({ ok: true });
      const after = await (await app.request("/api/models/availability")).json();
      expect(after.models).toEqual([]);
      expect(instance.repos.providers.get(locked.id)?.data.testStatus).toBe("active");
    } finally {
      instance.close();
    }
  });

  test("provider PUT/POST persist v1 flat patch fields into the data bag", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await app.request("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "deepseek", name: "Key 1", apiKey: "sk-one", priority: 1, testStatus: "unknown", group: "Public" }),
      });
      expect(created.status).toBe(201);
      const connection = (await created.json()).connection as Record<string, any>;
      expect(connection.group).toBe("Public");
      expect(connection.testStatus).toBe("unknown");
      expect(connection.apiKey).toBeUndefined();

      const updated = await app.request(`/api/providers/${connection.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed", priority: 3, group: "Private", apiKey: "sk-two", testStatus: "active", lastError: null, providerSpecificData: { region: "cn" } }),
      });
      expect(updated.status).toBe(200);
      const after = (await updated.json()).connection as Record<string, any>;
      expect(after.name).toBe("Renamed");
      expect(after.priority).toBe(3);
      expect(after.group).toBe("Private");
      expect(after.testStatus).toBe("active");
      expect(after.region).toBe("cn");
      expect(after.apiKey).toBeUndefined();
      expect(instance.repos.providers.get(connection.id)?.data.apiKey).toBe("sk-two");

      const badPool = await app.request(`/api/providers/${connection.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proxyPoolId: "missing-pool" }),
      });
      expect(badPool.status).toBe(400);
      expect((await badPool.json()).error).toBe("Proxy pool not found");
    } finally {
      instance.close();
    }
  });

  test("Grok CLI model discovery persists the v1 live catalog without clobbering it", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "grok-cli",
        authType: "oauth",
        credentials: { accessToken: "grok-token" },
        data: { providerSpecificData: { email: "user@example.test", userId: "user-1" } },
      });
      installFetchMock(async () => Response.json({ data: [{ id: "grok-code-fast", display_name: "Grok Code Fast" }] }));

      const response = await createApp(instance).request(`/api/providers/${connection.id}/models`);
      expect(response.status).toBe(200);
      expect((await response.json()).data).toContainEqual(expect.objectContaining({ id: "grok-code-fast", name: "Grok Code Fast" }));
      const saved = instance.repos.providers.get(connection.id)!;
      expect(saved.data.models).toEqual(["grok-code-fast"]);
      expect((saved.data.providerSpecificData as Record<string, unknown>).discoveredModels).toEqual([expect.objectContaining({ id: "grok-code-fast" })]);
    } finally {
      instance.close();
    }
  });
});
