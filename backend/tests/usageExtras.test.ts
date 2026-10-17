import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-usage-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("v1 usage extra routes", () => {
  test("stats validates period like v1", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const invalid = await app.request("/api/usage/stats?period=bogus");
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "Invalid period" });

      const stats = await app.request("/api/usage/stats");
      const payload = await stats.json();
      expect(payload.requests).toBe(0);
      expect(payload.total_tokens).toBe(0);

      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", promptTokens: 10, completionTokens: 5 });
      const updated = await (await app.request("/api/usage/stats?period=all")).json();
      expect(updated.requests).toBe(1);
      expect(updated.total_tokens).toBe(15);
    } finally {
      instance.close();
    }
  });

  test("by-account, by-model, and by-combo aggregate usage rows", async () => {
    const instance = await runtime();
    try {
      const account = instance.repos.providers.create({ provider: "claude", authType: "oauth", name: "Work Account", credentials: { accessToken: "token" } });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", connectionId: account.id, promptTokens: 10, completionTokens: 5, meta: { comboName: "fast-combo" } });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", connectionId: account.id, promptTokens: 2, completionTokens: 1 });
      instance.repos.usage.record({ provider: "gemini", model: "gemini-flash", promptTokens: 1, completionTokens: 1 });

      const app = createApp(instance);

      const invalid = await app.request("/api/usage/by-account?period=bogus");
      expect(invalid.status).toBe(400);

      const accounts = await (await app.request("/api/usage/by-account")).json();
      expect(accounts.pagination.totalItems).toBe(2);
      const work = accounts.items.find((row: { id: string }) => row.id === account.id);
      expect(work.name).toBe("Work Account");
      expect(work.usage.requests).toBe(2);
      expect(work.usage.totalTokens).toBe(18);

      const models = await (await app.request("/api/usage/by-model")).json();
      expect(models.items).toHaveLength(2);
      const sonnet = models.items.find((row: { id: string }) => row.id === "claude/claude-sonnet");
      expect(sonnet).toBeDefined();
      expect(sonnet.name).toBe("cc/claude-sonnet");
      expect(sonnet.usage.requests).toBe(2);
      expect(sonnet.usage.promptTokens).toBe(12);

      const combos = await (await app.request("/api/usage/by-combo")).json();
      const fast = combos.items.find((row: { id: string }) => row.id === "fast-combo");
      expect(fast).toBeDefined();
      expect(fast.usage.requests).toBe(1);

      const searched = await (await app.request("/api/usage/by-account?search=Work")).json();
      expect(searched.pagination.totalItems).toBe(1);
      expect(searched.items[0].id).toBe(account.id);
    } finally {
      instance.close();
    }
  });

  test("request-logs renders pipe-separated rows from usage history", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "claude", authType: "oauth", name: "Work Account", credentials: { accessToken: "token" } });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", connectionId: connection.id, promptTokens: 12, completionTokens: 34, status: "success" });
      const app = createApp(instance);
      const logs = await app.request("/api/usage/request-logs");
      const payload = await logs.json();
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(1);
      expect(payload[0]).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} \| claude-sonnet \| CLAUDE \| Work Account \| 12 \| 34 \| success$/);
    } finally {
      instance.close();
    }
  });

  test("usage stream pushes stats events and rejects invalid periods", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const invalid = await app.request("/api/usage/stream?period=bogus");
      expect(invalid.status).toBe(400);

      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", promptTokens: 7, completionTokens: 3 });
      const stream = await app.request("/api/usage/stream");
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toBe("text/event-stream");

      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let events = 0;
      while (events < 1) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (const line of buffer.split("\n")) {
          if (line.startsWith("data: ")) {
            const payload = JSON.parse(line.slice(6));
            expect(payload.requests).toBe(1);
            expect(payload.total_tokens).toBe(10);
            events += 1;
          }
        }
        buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
      }
      await reader.cancel();
      expect(events).toBeGreaterThanOrEqual(1);
    } finally {
      instance.close();
    }
  });

  test("codex reset credits validate connection type and proxy upstream results", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const missing = await app.request("/api/usage/missing/codex-reset-credits");
      expect(missing.status).toBe(404);

      const notCodex = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "token" } });
      const wrongProvider = await app.request(`/api/usage/${notCodex.id}/codex-reset-credits`);
      expect(wrongProvider.status).toBe(400);
      expect((await wrongProvider.json()).error).toContain("only available for Codex connections");

      const wrongAuth = instance.repos.providers.create({ provider: "codex", authType: "apikey", credentials: { apiKey: "key" } });
      const badAuth = await app.request(`/api/usage/${wrongAuth.id}/codex-reset-credits`);
      expect(badAuth.status).toBe(400);

      const codex = instance.repos.providers.create({ provider: "codex", authType: "access_token", credentials: { accessToken: "token" }, data: { chatgptAccountId: "acct-1" } });
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("rate-limit-reset-credits/consume")) {
          return new Response(JSON.stringify({ code: "no_credit", windows_reset: 0 }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ available_count: 2, credits: [{ status: "available", granted_at: 1750000000, expires_at: 1790000000 }] }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;

      const credits = await app.request(`/api/usage/${codex.id}/codex-reset-credits`);
      expect(await credits.json()).toEqual({
        availableCount: 2,
        credits: [{ status: "available", grantedAt: "2025-06-15T15:06:40.000Z", expiresAt: "2026-09-21T14:13:20.000Z" }],
      });

      const consume = await app.request(`/api/usage/${codex.id}/codex-reset-credits`, { method: "POST" });
      expect(consume.status).toBe(409);
      const consumePayload = await consume.json();
      expect(consumePayload.code).toBe("no_credit");
      expect(consumePayload.reset).toBe(false);
      expect(consumePayload.message).toBe("No Codex reset credits available.");
    } finally {
      instance.close();
    }
  });

  test("codex reset credits uses a valid OAuth access token without forced refresh", async () => {
    const instance = await runtime();
    try {
      const codex = instance.repos.providers.create({
        provider: "codex",
        authType: "oauth",
        credentials: { accessToken: "valid-access-token" },
        data: { chatgptAccountId: "acct-1" },
      });
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        expect(String(input)).toContain("rate-limit-reset-credits");
        return new Response(JSON.stringify({ available_count: 1, credits: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const response = await createApp(instance).request(`/api/usage/${codex.id}/codex-reset-credits`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ availableCount: 1, credits: [] });
    } finally {
      instance.close();
    }
  });

  test("usage reads the stored quota snapshot without an upstream request", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "token" } });
      const app = createApp(instance);
      let calls = 0;
      installFetchMock(async () => {
        calls += 1;
        return Response.json({ five_hour: { utilization: 25, resets_at: "2026-08-22T12:00:00.000Z" } });
      });

      const pending = await app.request(`/api/usage/${connection.id}`);
      expect(pending.status).toBe(200);
      expect((await pending.json()).snapshot).toMatchObject({ status: "pending" });
      expect(calls).toBe(0);

      const refreshed = await app.request(`/api/usage/${connection.id}/refresh`, { method: "POST" });
      expect(refreshed.status).toBe(200);
      expect(await refreshed.json()).toMatchObject({ plan: "Claude Code" });
      expect(calls).toBe(1);

      const snapshot = await app.request(`/api/usage/${connection.id}`);
      const payload = await snapshot.json();
      expect((payload.quotas as Record<string, unknown>)["session (5h)"]).toMatchObject({ used: 25, remaining: 75 });
      expect(payload.snapshot).toMatchObject({ status: "ready" });
      expect(calls).toBe(1);
    } finally {
      installFetchMock(null);
      instance.close();
    }
  });

  test("quota scheduler refreshes a new eligible connection in the background", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "token" } });
      let calls = 0;
      installFetchMock(async () => {
        calls += 1;
        return Response.json({ five_hour: { utilization: 10, resets_at: "2026-08-22T12:00:00.000Z" } });
      });

      instance.quotaSnapshots.start();
      for (let attempt = 0; attempt < 20 && !instance.repos.quotaSnapshots.get(connection.id); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(calls).toBe(1);
      expect(instance.repos.quotaSnapshots.get(connection.id)).toMatchObject({ status: "ready", provider: "claude" });
    } finally {
      installFetchMock(null);
      instance.close();
    }
  });

  // Regression: seeded/imported v1 rows keep provider extras in a nested
  // providerSpecificData object. The background quota refresh must hand
  // executors that real nested object before it stores the quota snapshot.
  test("quota refresh stores usage for v1-shaped qoder PAT connections", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const connection = instance.repos.providers.create({
        provider: "qoder",
        authType: "oauth",
        name: "Qoder PAT",
        credentials: {
          accessToken: "stale-token",
          refreshToken: "jrt-stale",
          expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
          providerSpecificData: {
            authMethod: "pat",
            userId: "user-1",
            machineId: "machine-1",
            organizationId: "",
            personalAccessToken: "pt-regression",
            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: "",
            vercelRelayUrl: "",
          },
        },
      });
      const app = createApp(instance);
      const calls: { url: string; authorization: string; method: string; body: string }[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers || {}) as Record<string, string>;
        calls.push({
          url: String(input instanceof Request ? input.url : input),
          authorization: headers.Authorization || headers.authorization || "",
          method: init?.method || "GET",
          body: typeof init?.body === "string" ? init.body : "",
        });
        if (String(input).includes("/api/v1/jobToken/exchange")) {
          return Response.json({ token: "jt-fresh", refresh_token: "jrt-fresh", expires_in: 86400 });
        }
        if (String(input).includes("/api/v2/quota/usage")) {
          return Response.json({
            userQuota: { total: 100, used: 25, remaining: 75, unit: "credits" },
            orgResourcePackage: { total: 10, used: 5, remaining: 5, unit: "credits" },
            expiresAt: Date.now() + 86_400_000,
          });
        }
        return Response.json({ data: { activities: [] } });
      });

      const refresh = await app.request(`/api/usage/${connection.id}/refresh`, { method: "POST" });
      expect(refresh.status).toBe(200);
      const response = await app.request(`/api/usage/${connection.id}`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.quotas.user).toMatchObject({ total: 100, used: 25, remaining: 75 });
      expect(payload.quotas.organization).toMatchObject({ total: 10, used: 5 });

      const exchange = calls.find((call) => call.url.includes("/api/v1/jobToken/exchange"));
      expect(exchange?.body).toContain("pt-regression");
      const quota = calls.find((call) => call.url.includes("/api/v2/quota/usage"));
      expect(quota?.authorization).toBe("Bearer jt-fresh");

      const updated = instance.repos.providers.get(connection.id);
      const updatedCredentials = updated?.credentials as Record<string, any>;
      expect(updatedCredentials.accessToken).toBe("jt-fresh");
      expect(updatedCredentials.refreshToken).toBe("jrt-fresh");
      expect(updatedCredentials.providerSpecificData.personalAccessToken).toBe("pt-regression");
      expect(updatedCredentials.providerSpecificData.authMethod).toBe("pat");
    } finally {
      installFetchMock(null);
      instance.close();
    }
  });
});
