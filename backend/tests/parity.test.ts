import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-parity-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("v1 dashboard parity routes", () => {
  test("exposes signed OIDC session identity through the v1 auth-status contract", async () => {
    const instance = await runtime();
    try {
      const token = await instance.auth.createSession("oidc:user-1", { oidc: true, oidcName: "Ada Lovelace", oidcEmail: "ada@example.test" });
      const response = await createApp(instance).request("/api/auth/status", { headers: { cookie: `auth_token=${token}` } });
      expect(await response.json()).toMatchObject({ authenticated: true, displayName: "Ada Lovelace", loginMethod: "OIDC", oidcName: "Ada Lovelace", oidcEmail: "ada@example.test", oidcLogin: true });
    } finally {
      instance.close();
    }
  });

  test("matches v1 management envelopes and input validation", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      expect((await app.request("/api/combos")).json()).resolves.toEqual({ combos: [] });
      expect((await app.request("/api/provider-nodes")).json()).resolves.toEqual({ nodes: [] });
      expect((await app.request("/api/proxy-pools")).json()).resolves.toEqual({ proxyPools: [] });

      const invalidCombo = await app.request("/api/combos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "not valid", models: [] }) });
      expect(invalidCombo.status).toBe(400);
      expect((await invalidCombo.json()).error).toContain("letters");

      const invalidNode = await app.request("/api/provider-nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Node", prefix: "node" }) });
      expect(invalidNode.status).toBe(400);
      expect((await invalidNode.json()).error).toContain("Invalid OpenAI");

      const createdPool = await app.request("/api/proxy-pools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: " Work ", proxyUrl: " http://proxy.test:8080 " }) });
      expect(createdPool.status).toBe(201);
      const poolPayload = await createdPool.json();
      expect(poolPayload.proxyPool.name).toBe("Work");
      expect(poolPayload.proxyPool.type).toBe("http");
      expect(poolPayload.proxyPool.isActive).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("keeps provider metadata usable by the dashboard while redacting credentials", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "openai",
        authType: "apikey",
        credentials: { apiKey: "secret-key" },
        data: { group: "Production", region: "us-east" },
      });
      const payload = await (await createApp(instance).request("/api/providers")).json();
      expect(payload.connections[0].data).toEqual({ group: "Production", region: "us-east" });
      expect(payload.connections[0].credentials).toEqual({});
      expect(payload.connections[0].apiKey).toBeUndefined();
    } finally {
      instance.close();
    }
  });

  test("matches v1 safe settings response and bcrypt password update behavior", async () => {
    const instance = await runtime();
    try {
      instance.repos.settings.update({ requireLogin: true, oidcIssuerUrl: "https://issuer.test", oidcClientId: "client", oidcClientSecret: "secret", passwordHash: await Bun.password.hash("old-password", { algorithm: "bcrypt", cost: 4 }) });
      const app = createApp(instance);
      const settings = await app.request("/api/settings");
      const payload = await settings.json();
      expect(settings.headers.get("cache-control")).toBe("no-store");
      expect(payload.hasPassword).toBe(true);
      expect(payload.oidcConfigured).toBe(true);
      expect(payload.passwordHash).toBeUndefined();
      expect(payload.oidcClientSecret).toBeUndefined();

      const updated = await app.request("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }) });
      expect(updated.status).toBe(200);
      expect(await Bun.password.verify("new-password", String(instance.repos.settings.get().passwordHash))).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("supports admin API-key list pagination with stored keys", async () => {
    const instance = await runtime();
    try {
      instance.repos.keys.create({ name: "First", key: "sk-first-key" });
      instance.repos.keys.create({ name: "Second", key: "sk-second-key" });
      const app = createApp(instance);
      const response = await app.request("/api/keys?page=2&pageSize=1");
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.keys).toHaveLength(1);
      expect(payload.pagination).toEqual({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
      expect(payload.keys[0].key).toBe("sk-second-key");
    } finally {
      instance.close();
    }
  });

  test("matches v1 request-details filtering and pagination", async () => {
    const instance = await runtime();
    try {
      const timestamp = new Date().toISOString();
      instance.sqlite.query("INSERT INTO requestDetails (id, timestamp, provider, model, connectionId, status, data) VALUES (?, ?, ?, ?, ?, ?, ?)").run("detail-1", timestamp, "openai", "gpt-test", "connection-1", "success", JSON.stringify({ id: "detail-1", provider: "openai", model: "gpt-test" }));
      instance.sqlite.query("INSERT INTO requestDetails (id, timestamp, provider, model, connectionId, status, data) VALUES (?, ?, ?, ?, ?, ?, ?)").run("detail-2", timestamp, "anthropic", "claude-test", "connection-2", "error", JSON.stringify({ id: "detail-2", provider: "anthropic", model: "claude-test" }));
      const app = createApp(instance);
      const response = await app.request("/api/usage/request-details?provider=openai&page=1&pageSize=1");
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.details).toEqual([{ id: "detail-1", provider: "openai", model: "gpt-test", displayModel: "openai/gpt-test" }]);
      expect(payload.pagination).toEqual({ page: 1, pageSize: 1, totalItems: 1, totalPages: 1, hasNext: false, hasPrev: false });

      const invalid = await app.request("/api/usage/request-details?pageSize=101");
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).error).toContain("between 1 and 100");
    } finally {
      instance.close();
    }
  });

  test("exposes the v1 generic OAuth authorization contract", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const response = await app.request("/api/oauth/claude/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback");
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.flowType).toBeDefined();
      expect(payload.redirectUri).toBe("http://localhost:8080/callback");
      expect(payload.state).toBeString();
      expect(payload.codeVerifier).toBeString();
    } finally {
      instance.close();
    }
  });

  test("exposes provider validation, batch testing, and model-fetch route contracts", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/models")) return Response.json({ data: [{ id: "gpt-test" }] });
        return Response.json({ ok: true });
      }) as typeof fetch;
      const connection = instance.repos.providers.create({ provider: "openai", authType: "apikey", apiKey: "test-key", baseUrl: "https://api.test/v1", data: { models: ["gpt-test"] } });
      const app = createApp(instance);
      const validation = await app.request("/api/providers/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "openai", apiKey: "test-key", baseUrl: "https://api.test/v1" }) });
      expect(validation.status).toBe(200);
      expect((await validation.json()).valid).toBe(true);
      const batch = await app.request("/api/providers/test-batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "provider", providerId: "openai" }) });
      expect(batch.status).toBe(200);
      expect((await batch.json()).summary.total).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("supports provider suggestions contracts", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => Response.json({ data: [
        { id: "big-pickle-free", name: "Big Pickle Free" },
        { id: "paid-small", name: "Paid Small" },
      ] })) as unknown as typeof fetch;
      const app = createApp(instance);
      // v1 filters: opencode-free keeps only "-free" (or known free) models; unknown types 400.
      const suggestions = await app.request("/api/providers/suggested-models?url=https%3A%2F%2Fmodels.test&type=opencode-free");
      expect((await suggestions.json()).data).toEqual([{ id: "big-pickle-free", name: "big-pickle-free" }]);
      const unknown = await app.request("/api/providers/suggested-models?url=https%3A%2F%2Fmodels.test&type=chat");
      expect(unknown.status).toBe(400);
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("supports specialized provider token import contracts", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => Response.json({ success: true })) as unknown as typeof fetch;
      const app = createApp(instance);
      const codexToken = ["header", btoa(JSON.stringify({ email: "codex@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "workspace" } })), "signature"].join(".");
      const codex = await app.request("/api/oauth/codex/import-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: codexToken }) });
      expect(codex.status).toBe(200);
      expect((await codex.json()).connection.workspace).toBe("workspace");
      // Exported Codex accounts nest tokens under `tokens.*`. Bulk import must
      // read that shape so id_token survives a round-trip (not silently null).
      const idToken = ["header", btoa(JSON.stringify({ email: "round@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "ws-rt" } })), "signature"].join(".");
      const bulk = await app.request("/api/oauth/codex/bulk-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accounts: [{ auth_mode: "chatgpt", tokens: { id_token: idToken, access_token: "access-rt", refresh_token: "refresh-rt", account_id: "ws-rt" } }] }) });
      expect(bulk.status).toBe(200);
      const bulkJson = await bulk.json();
      expect(bulkJson.success).toBe(1);
      const stored = instance.repos.providers.list(true).find((c) => c.email === "round@example.com");
      expect(stored?.data?.idToken).toBe(idToken);
      expect(stored?.data?.refreshToken).toBe("refresh-rt");
      expect(stored?.data?.chatgptAccountId).toBe("ws-rt");
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });

  test("supports Gemini generateContent compatibility routing", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", apiKey: "key", baseUrl: "https://api.test/v1", data: { models: ["gpt-test"] } });
      installFetchMock(async () => Response.json({ id: "chatcmpl-1", object: "chat.completion", model: "gpt-test", choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }));
      const app = createApp(instance);
      const response = await app.request("/v1beta/models/openai/gpt-test:generateContent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }) });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.candidates[0].content.parts[0].text).toBe("hello");
      expect(payload.usageMetadata.totalTokenCount).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
      installFetchMock(null);
      instance.close();
    }
  });

  test("lists configured models and aliases through every public model-list entry point", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "openai", authType: "apikey", data: { prefix: "openai", models: ["gpt-test"] } });
      instance.repos.aliases.set("fast", "openai/gpt-test");
      const app = createApp(instance);

      const root = await app.request("/v1");
      const modelList = await app.request("/v1/models");
      const chatList = await app.request("/v1/models/chat");
      const rootPayload = await root.json();
      expect(root.status).toBe(200);
      expect(rootPayload).toEqual(await modelList.json());
      expect(rootPayload.data.map((model: { id: string }) => model.id)).toEqual(["openai/gpt-test", "fast"]);
      // v1 has no "chat" kind slug — the bare list serves LLMs and chat 404s.
      expect(chatList.status).toBe(404);
      expect((await app.request("/v1/models/info?id=fast")).json()).resolves.toMatchObject({ id: "fast", root_model: "openai/gpt-test" });

      instance.repos.keys.create({ key: "sk-model-access", modelAccessMode: "whitelist", modelAccessList: ["openai/gpt-test"] });
      const restricted = await (await app.request("/v1/models", { headers: { authorization: "Bearer sk-model-access" } })).json();
      expect(restricted.data.map((model: { id: string }) => model.id)).toEqual(["openai/gpt-test", "fast"]);
    } finally {
      instance.close();
    }
  });


  test("supports translator metadata, replay files, and redacted target details", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({ provider: "anthropic", apiType: "anthropic", baseUrl: "https://provider.test" });
      const app = createApp(instance);
      const stepOne = await app.request("/api/translator/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: 1, body: { model: "anthropic/claude-test", messages: [{ role: "user", content: "hi" }] } }),
      });
      expect(stepOne.status).toBe(200);
      expect((await stepOne.json()).result.targetFormat).toBe("claude");

      const saved = await app.request("/api/translator/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file: "1_req_client.json", content: "{\"model\":\"x\"}" }),
      });
      expect(saved.status).toBe(200);
      const loaded = await app.request("/api/translator/load?file=1_req_client.json");
      expect((await loaded.json()).content).toBe("{\"model\":\"x\"}");

      const target = await app.request("/api/translator/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: 3, body: { provider: "anthropic", model: "claude-test", body: { model: "claude-test", messages: [{ role: "user", content: "hi" }], stream: true } } }),
      });
      const targetPayload = await target.json();
      expect(target.status).toBe(200);
      expect(targetPayload.result.url).toBe("https://api.anthropic.com/v1/messages");
      expect(targetPayload.result.headers["x-api-key"]).toBeUndefined();
      expect(targetPayload.result.capability.headersRedacted).toBe(true);
    } finally {
      instance.close();
    }
  });

  test("builds translator target details with the selected provider executor", async () => {
    const instance = await runtime();
    try {
      instance.repos.providers.create({
        provider: "antigravity",
        authType: "oauth",
        credentials: { accessToken: "translator-test-token" },
        data: { projectId: "project-1" },
      });
      const response = await createApp(instance).request("/api/translator/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: 3,
          body: {
            provider: "antigravity",
            model: "gemini-pro-agent",
            body: { model: "gemini-pro-agent", messages: [{ role: "user", content: "hi" }], stream: true },
          },
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.result.url).toContain(":streamGenerateContent?alt=sse");
      expect(payload.result.body).toMatchObject({ project: "project-1", model: "gemini-pro-agent" });
      expect(payload.result.headers.authorization).toBe("[configured]");
    } finally {
      instance.close();
    }
  });

  test("streams and clears console logs without retaining listeners", async () => {
    const instance = await runtime();
    try {
      instance.consoleLogs.clear();
      console.log("parity-console-line");
      const app = createApp(instance);
      const response = await app.request("/api/translator/console-logs/stream");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain("parity-console-line");
      await reader.cancel();

      const cleared = await app.request("/api/translator/console-logs", { method: "DELETE" });
      expect(cleared.status).toBe(200);
      expect((await app.request("/api/translator/console-logs")).json()).resolves.toEqual({ success: true, logs: [] });
    } finally {
      instance.close();
    }
  });

  test("generates CLI config text", async () => {
    const instance = await runtime();
    try {
      instance.repos.models.upsert({ provider: "openai", model: "gpt-test", kind: "chat" });
      const app = createApp(instance);
      const generated = await app.request("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: "http://127.0.0.1:20129", models: ["openai/gpt-test"], apiKey: "secret" }),
      });
      const payload = await generated.json();
      expect(generated.status).toBe(200);
      expect(payload.generated).toBe(true);
      expect(payload.applied).toBe(true);
      expect(payload.content).toContain("openai/gpt-test");

      const statuses = await app.request("/api/cli-tools/all-statuses");
      expect((await statuses.json()).claude.capability.canApplyLocally).toBe(true);

    } finally {
      instance.close();
    }
  });

  test("probes an MCP server through initialize and tools/list", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = (async (_input, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body || "{}")) as { method?: string };
        if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: 1, result: {} }, { headers: { "mcp-session-id": "session-1" } });
        if (body.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search", description: "Search" }] } });
        return Response.json({ jsonrpc: "2.0" });
      }) as typeof fetch;
      const app = createApp(instance);
      const response = await app.request("/api/cli-tools/cowork-mcp-tools", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://mcp.example.test/mcp" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).tools).toEqual([{ name: "search", description: "Search" }]);
      expect(calls).toBe(3);
      expect((await app.request("/api/mcp/browsermcp/sse")).status).toBe(501);
    } finally {
      globalThis.fetch = originalFetch;
      instance.close();
    }
  });
});
