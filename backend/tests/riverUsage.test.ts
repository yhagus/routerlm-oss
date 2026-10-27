import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { fetchConnectionUsageFromProvider } from "../src/services/providers/providerUsage";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-river-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => installFetchMock(null));

function authenticatedSession(refreshToken: string) {
  return Response.json({ access_token: "access-token", refresh_token: refreshToken, user: { email: "river@example.com" } });
}

describe("River AI wallet", () => {
  test("bulk create authenticates and persists the rotated session", async () => {
    const instance = await runtime();
    try {
      const calls: string[] = [];
      installFetchMock(async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/user_management/authenticate")) {
          expect(new Headers(init?.headers).get("cookie")).toBe("workos-session=refresh-1");
          expect(JSON.parse(String(init?.body))).toEqual({ client_id: "client-1", grant_type: "refresh_token" });
          return authenticatedSession("refresh-2");
        }
        return new Response("{}", { status: 200 });
      });

      const response = await createApp(instance).request("/api/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "river",
          authType: "apikey",
          name: "River 1",
          apiKey: "sk-river",
          providerSpecificData: { riverRefreshToken: "refresh-1", riverClientId: "client-1" },
        }),
      });

      expect(response.status).toBe(201);
      const created = (await response.json()).connection;
      const stored = instance.repos.providers.get(created.id)!;
      expect(stored.email).toBe("river@example.com");
      expect(stored.data.riverAccessToken).toBe("access-token");
      expect(stored.data.riverRefreshToken).toBe("refresh-2");
      expect(stored.credentials.apiKey).toBe("sk-river");
      expect(calls.filter((url) => url.includes("/user_management/authenticate"))).toHaveLength(1);
    } finally {
      instance.close();
    }
  });

  test("usage reads balance_usd through the bearer token", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "River",
        credentials: { apiKey: "sk-river" },
        data: {
          riverRefreshToken: "refresh-1",
          riverClientId: "client-1",
          riverAccessToken: "access-token",
          riverAccessExpiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
      });
      installFetchMock(async (input, init) => {
        expect(String(input)).toBe("https://console.river.ai/api/billing/account");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
        return Response.json({ balance_usd: 24.99927 });
      });

      const result = await fetchConnectionUsageFromProvider(instance, connection.id);
      expect(result.status).toBe(200);
      expect((result.body.quotas as Record<string, any>)["Balance (USD)"].balance).toBe(24.99927);
    } finally {
      instance.close();
    }
  });

  test("an expired access token re-authenticates and rotates the refresh token", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "River",
        credentials: { apiKey: "sk-river" },
        data: {
          riverRefreshToken: "refresh-1",
          riverClientId: "client-1",
          riverAccessToken: "old-token",
          riverAccessExpiresAt: new Date(Date.now() - 5_000).toISOString(),
        },
      });
      installFetchMock(async (input) => {
        if (String(input).includes("/user_management/authenticate")) return authenticatedSession("refresh-2");
        return Response.json({ balance_usd: 0 });
      });

      const result = await fetchConnectionUsageFromProvider(instance, connection.id);
      expect(result.status).toBe(200);
      expect((result.body.quotas as Record<string, any>)["Balance (USD)"].balance).toBe(0);
      expect(instance.repos.providers.get(connection.id)!.data.riverRefreshToken).toBe("refresh-2");
    } finally {
      instance.close();
    }
  });

  test("a missing session pair shows an invalid dash, not a zero balance", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "No session",
        credentials: { apiKey: "sk-river" },
        data: { riverRefreshToken: "refresh-only" },
      });
      installFetchMock(async () => {
        throw new Error("upstream must not be called");
      });

      const result = await fetchConnectionUsageFromProvider(instance, connection.id);
      expect(result.status).toBe(200);
      expect(result.body.message).toBe("-");
      expect((result.body.quotas as Record<string, any>)["Balance (USD)"].balance).toBeNull();
    } finally {
      instance.close();
    }
  });
});

describe("River AI provider test", () => {
  test("checks the API key, refreshes the session, and refreshes the quota", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "River",
        credentials: { apiKey: "sk-river" },
        data: { riverRefreshToken: "refresh-1", riverClientId: "client-1" },
      });
      installFetchMock(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/models")) return new Response("{}", { status: 200 });
        if (url.includes("/user_management/authenticate")) {
          expect(new Headers(init?.headers).get("cookie")).toBe("workos-session=refresh-1");
          return authenticatedSession("refresh-2");
        }
        return Response.json({ balance_usd: 3.5 });
      });

      const response = await createApp(instance).request(`/api/providers/${connection.id}/test`, { method: "POST" });
      expect(await response.json()).toMatchObject({ valid: true, refreshed: true, error: null });

      const stored = instance.repos.providers.get(connection.id)!;
      expect(stored.data.testStatus).toBe("active");
      expect(stored.data.riverRefreshToken).toBe("refresh-2");
      expect(instance.repos.quotaSnapshots.get(connection.id)).toMatchObject({ status: "ready" });
    } finally {
      instance.close();
    }
  });

  test("an invalid API key fails without touching the session", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "River",
        credentials: { apiKey: "sk-bad" },
        data: { riverRefreshToken: "refresh-1", riverClientId: "client-1" },
      });
      const calls: string[] = [];
      installFetchMock(async (input) => {
        calls.push(String(input));
        return new Response("{}", { status: 401 });
      });

      const response = await createApp(instance).request(`/api/providers/${connection.id}/test`, { method: "POST" });
      expect(await response.json()).toMatchObject({ valid: false, error: "Invalid API key", refreshed: false });
      expect(calls.some((url) => url.includes("/user_management/authenticate"))).toBe(false);
      expect(instance.repos.providers.get(connection.id)!.data.testStatus).toBe("error");
    } finally {
      instance.close();
    }
  });

  test("a valid key without a session passes with a warning", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "River",
        credentials: { apiKey: "sk-river" },
        data: {},
      });
      installFetchMock(async () => new Response("{}", { status: 200 }));

      const response = await createApp(instance).request(`/api/providers/${connection.id}/test`, { method: "POST" });
      const result = await response.json();
      expect(result.valid).toBe(true);
      expect(result.error).toContain("Credit session not configured");
    } finally {
      instance.close();
    }
  });
});

describe("River AI export", () => {
  test("exports the bulk format and omits an absent name or session", async () => {
    const instance = await runtime();
    try {
      const complete = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "Full",
        credentials: { apiKey: "sk-full" },
        data: { riverRefreshToken: "refresh-1", riverClientId: "client-1" },
      });
      const keyOnly = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: "Named",
        credentials: { apiKey: "sk-named" },
      });
      const bare = instance.repos.providers.create({
        provider: "river",
        authType: "apikey",
        name: null,
        credentials: { apiKey: "sk-bare" },
      });

      const response = await createApp(instance).request("/api/providers/export/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionIds: [complete.id, keyOnly.id, bare.id] }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Full|sk-full|refresh-1:client-1\nNamed|sk-named\nsk-bare");
    } finally {
      instance.close();
    }
  });
});
