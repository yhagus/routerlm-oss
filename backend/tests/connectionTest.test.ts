import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { refreshConnectionCredentials } from "../src/services/providers/refreshCoordinator";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-conn-test-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

// Reset the harness mock so later test files observe real fetch (e.g. loopback
// callback-proxy requests).
afterEach(() => { installFetchMock(null); });

describe("v1 connection test port", () => {
  test("qoder oauth rows probe the userinfo endpoint and persist v1 status", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const connection = instance.repos.providers.create({
        provider: "qoder",
        authType: "oauth",
        name: "Qoder",
        credentials: {
          accessToken: "jt-live",
          providerSpecificData: { authMethod: "device", userId: "u1", personalAccessToken: "" },
        },
      });
      const calls: Array<{ url: string; authorization: string }> = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = (init?.headers || {}) as Record<string, string>;
        calls.push({ url: String(input instanceof Request ? input.url : input), authorization: headers.Authorization || headers.authorization || "" });
        return Response.json({ id: "u1" });
      });
      const app = createApp(instance);
      const response = await app.request(`/api/providers/${connection.id}/test`, { method: "POST" });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.valid).toBe(true);
      expect(payload.error).toBe(null);
      expect(calls[0].url).toBe("https://openapi.qoder.sh/api/v1/userinfo");
      expect(calls[0].authorization).toBe("Bearer jt-live");
      // v1 writes testStatus "active" (not "ok") on success.
      expect(instance.repos.providers.get(connection.id)?.data.testStatus).toBe("active");
      // providers.patch removes a field that the test clears.
      expect(instance.repos.providers.get(connection.id)?.data).not.toHaveProperty("lastError");
    } finally {
      instance.close();
    }
  });

  test("compatible rows probe psd.baseUrl/models like v1", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const connection = instance.repos.providers.create({
        provider: "openai-compatible-chat-x",
        authType: "apikey",
        name: "Node",
        credentials: {
          apiKey: "node-key",
          providerSpecificData: { baseUrl: "https://node.test/v1", apiType: "chat", prefix: "nx" },
        },
      });
      const calls: string[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(String(input instanceof Request ? input.url : input));
        const headers = new Headers((init?.headers || {}) as Record<string, string>);
        expect(headers.get("authorization")).toBe("Bearer node-key");
        return Response.json({ data: [{ id: "m1" }] });
      });
      const app = createApp(instance);
      const response = await app.request(`/api/providers/${connection.id}/test`, { method: "POST" });
      expect((await response.json()).valid).toBe(true);
      expect(calls).toEqual(["https://node.test/v1/models"]);
    } finally {
      instance.close();
    }
  });

  test("expired antigravity tokens refresh then retry, and rotated tokens persist", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const connection = instance.repos.providers.create({
        provider: "antigravity",
        authType: "oauth",
        name: "Antigravity",
        credentials: {
          accessToken: "ya29-stale",
          refreshToken: "1//stale",
          expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
          providerSpecificData: {},
        },
      });
      const seen: string[] = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        seen.push(url);
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "ya29-fresh", expires_in: 3600, refresh_token: "1//stale" });
        }
        // Cloud Code Assist probe (v1 path for antigravity).
        expect(url).toContain("loadCodeAssist");
        const headers = new Headers((init?.headers || {}) as Record<string, string>);
        expect(headers.get("authorization")).toBe("Bearer ya29-fresh");
        return Response.json({}, { status: 200 });
      });
      const app = createApp(instance);
      const response = await app.request(`/api/providers/${connection.id}/test`, { method: "POST" });
      const payload = await response.json();
      expect(payload.valid).toBe(true);
      expect(payload.refreshed).toBe(true);
      const updated = instance.repos.providers.get(connection.id);
      expect(updated?.data.accessToken).toBe("ya29-fresh");
      expect(String(updated?.data.expiresAt).length).toBeGreaterThan(10);
      expect(seen[0]).toBe("https://oauth2.googleapis.com/token");
    } finally {
      instance.close();
    }
  });

  test("a refresh stored while the probe waits is not overwritten by the test result", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "antigravity",
        authType: "oauth",
        name: "Antigravity",
        credentials: {
          accessToken: "ya29-stale",
          refreshToken: "1//first",
          expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
          providerSpecificData: {},
        },
      });
      let tokenCalls = 0;
      let releaseProbe!: () => void;
      const probeReleased = new Promise<void>((resolve) => { releaseProbe = resolve; });
      let probeStarted!: () => void;
      const probeSeen = new Promise<void>((resolve) => { probeStarted = resolve; });
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url === "https://oauth2.googleapis.com/token") {
          tokenCalls += 1;
          return tokenCalls === 1
            ? Response.json({ access_token: "ya29-fresh", expires_in: 3600, refresh_token: "1//second" })
            : Response.json({ access_token: "ya29-newer", expires_in: 3600, refresh_token: "1//third" });
        }
        probeStarted();
        await probeReleased;
        return Response.json({}, { status: 200 });
      });

      const test = createApp(instance).request(`/api/providers/${connection.id}/test`, { method: "POST" });
      await probeSeen;
      // A chat request gets a 401 for ya29-fresh and refreshes again.
      const newer = await refreshConnectionCredentials(instance, connection.id, { failedAccessToken: "ya29-fresh" });
      expect(newer?.credentials.accessToken).toBe("ya29-newer");
      releaseProbe();
      expect((await (await test).json()).valid).toBe(true);

      const stored = instance.repos.providers.get(connection.id)!.data;
      expect(stored.accessToken).toBe("ya29-newer");
      expect(stored.refreshToken).toBe("1//third");
    } finally {
      instance.close();
    }
  });

  test("codex probes the responses endpoint and accepts 400 like v1", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const connection = instance.repos.providers.create({
        provider: "codex",
        authType: "oauth",
        name: "Codex",
        credentials: { accessToken: "codex-token", refreshToken: "r", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), lastRefreshAt: new Date().toISOString(), providerSpecificData: {} },
      });
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("auth.openai.com")) return Response.json({ access_token: "fresh", refresh_token: "r2", expires_in: 3600 });
        expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
        return Response.json({ error: "bad request" }, { status: 400 });
      });
      const app = createApp(instance);
      const response = await app.request(`/api/providers/${connection.id}/test`, { method: "POST" });
      const payload = await response.json();
      // 400 on the minimal invalid body proves auth succeeded (v1 acceptStatuses).
      expect(payload.valid).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("validate routes use v1 per-provider probes", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const calls: string[] = [];
      installFetchMock(async (input: RequestInfo | URL) => {
        calls.push(String(input instanceof Request ? input.url : input));
        return Response.json({ data: [] });
      });
      const app = createApp(instance);
      const anthropic = await app.request("/api/providers/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant" }) });
      expect(anthropic.status).toBe(200);
      expect((await anthropic.json()).valid).toBe(true);
      expect(calls[0]).toBe("https://api.anthropic.com/v1/messages");
      const unsupported = await app.request("/api/providers/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "made-up-provider", apiKey: "x" }) });
      expect(unsupported.status).toBe(400);
      expect((await unsupported.json()).error).toBe("Provider validation not supported");
    } finally {
      instance.close();
    }
  });

  test("ZenMux validation and discovery use its model catalog", async () => {
    const instance = await runtime();
    try {
      const calls: Array<{ url: string; authorization: string }> = [];
      installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input instanceof Request ? input.url : input), authorization: headers.get("authorization") || "" });
        return Response.json({ data: [
          { id: "openai/gpt-5", display_name: "GPT-5", output_modalities: ["text"], input_modalities: ["text"] },
          { id: "openai/gpt-5-vision", display_name: "GPT-5 Vision", output_modalities: ["text"], input_modalities: ["text", "image"] },
          { id: "openai/gpt-image-1", display_name: "GPT Image", output_modalities: ["image"], input_modalities: ["text"] },
        ] });
      });
      const app = createApp(instance);
      const validation = await app.request("/api/providers/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "zenmux", apiKey: "zenmux-key" }) });
      expect((await validation.json()).valid).toBe(true);
      const connection = instance.repos.providers.create({ provider: "zenmux", authType: "apikey", credentials: { apiKey: "zenmux-key" } });
      const response = await app.request(`/api/providers/${connection.id}/models`);
      expect(response.status).toBe(200);
      expect((await response.json()).data.map((model: { id: string }) => model.id)).toEqual(["openai/gpt-5", "openai/gpt-5-vision"]);
      expect(instance.repos.providers.get(connection.id)?.data.models).toEqual(["openai/gpt-5", "openai/gpt-5-vision"]);
      expect(calls).toEqual([
        { url: "https://zenmux.ai/api/v1/models", authorization: "Bearer zenmux-key" },
        { url: "https://zenmux.ai/api/v1/models", authorization: "Bearer zenmux-key" },
      ]);
    } finally {
      instance.close();
    }
  });
});
