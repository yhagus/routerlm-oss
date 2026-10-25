import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";
import { getExecutor } from "../src/services/chat/executors/index.ts";
import { getTargetFormat } from "../src/services/providers/provider.ts";
import { isAnthropicCompatibleProvider } from "../src/services/platform/shared/constants/providers.ts";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-provider-nodes-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

afterEach(() => installFetchMock(null));

describe("provider node validation", () => {
  test("validates input and keeps remote probes away from private URLs", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const required = await app.request("/api/provider-nodes/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      expect(required.status).toBe(400);
      expect(await required.json()).toEqual({ error: "Base URL and API key required" });

      const invalid = await app.request("/api/provider-nodes/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: "not a URL", apiKey: "key" }) });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "Invalid URL format" });

      const blocked = await app.request("http://example.test/api/provider-nodes/validate", { method: "POST", headers: { "content-type": "application/json", "x-lobak-real-ip": "203.0.113.1" }, body: JSON.stringify({ baseUrl: "http://127.0.0.1:11434/v1", apiKey: "key" }) });
      expect(blocked.status).toBe(400);
      expect(await blocked.json()).toEqual({ error: "URL not allowed" });
    } finally {
      instance.close();
    }
  });

  test("uses type-specific normalized probes and embedding response contract", async () => {
    const instance = await runtime();
    try {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      installFetchMock(async (input, init) => {
        calls.push({ url: String(input), init });
        return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
      });
      const app = createApp(instance);
      const response = await app.request("/api/provider-nodes/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: "https://embed.test/v1/embeddings/", apiKey: "embed-key", type: "custom-embedding", modelId: " embed-model " }) });
      expect(await response.json()).toEqual({ valid: true, method: "embeddings", dimensions: 3 });
      expect(calls[0]?.url).toBe("https://embed.test/v1/embeddings");
      expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer embed-key");
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ model: "embed-model", input: "ping" }));
    } finally {
      instance.close();
    }
  });

  test("falls back to chat after a non-auth models failure with type auth headers", async () => {
    const instance = await runtime();
    try {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      installFetchMock(async (input, init) => {
        calls.push({ url: String(input), init });
        return calls.length === 1 ? new Response("missing", { status: 404 }) : Response.json({ id: "ok" });
      });
      const app = createApp(instance);
      const response = await app.request("/api/provider-nodes/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: "https://anthropic.test/v1/messages/", apiKey: "ant-key", type: "anthropic-compatible", modelId: "claude-test" }) });
      expect(await response.json()).toEqual({ valid: true, method: "chat" });
      expect(calls.map((call) => call.url)).toEqual(["https://anthropic.test/v1/models", "https://anthropic.test/v1/chat/completions"]);
      const headers = new Headers(calls[1]?.init?.headers);
      expect(headers.get("x-api-key")).toBe("ant-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
    } finally {
      instance.close();
    }
  });

  test("returns a safe legacy-style failure envelope for probe errors", async () => {
    const instance = await runtime();
    try {
      installFetchMock(async () => { throw new Error("socket failed", { cause: { code: "ECONNREFUSED" } }); });
      const app = createApp(instance);
      const response = await app.request("/api/provider-nodes/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: "https://node.test/v1", apiKey: "key" }) });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ valid: false, error: "Connection refused - provider node offline or unreachable" });
    } finally {
      instance.close();
    }
  });
});

describe("user-chosen provider node ids", () => {
  const post = (app: ReturnType<typeof createApp>, body: Record<string, unknown>) =>
    app.request("/api/provider-nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  test("routes a free id by its stored node type and api type", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await post(app, { id: "provider-hakim", name: "Hakim", prefix: "hakim", type: "openai-compatible", apiType: "responses", baseUrl: "https://hakim.test/v1/" });
      expect(created.status).toBe(201);
      expect((await created.json()).node.id).toBe("provider-hakim");
      expect(getTargetFormat("provider-hakim")).toBe("openai-responses");
      const url = getExecutor("provider-hakim").buildUrl("m", true, 0, { providerSpecificData: { baseUrl: "https://hakim.test/v1/" } });
      expect(url).toBe("https://hakim.test/v1/responses");

      // An id that contains "responses" must not flip a chat node to the Responses API.
      await post(app, { id: "responses-gateway", name: "Gateway", prefix: "gw", type: "openai-compatible", apiType: "chat", baseUrl: "https://gw.test/v1" });
      expect(getTargetFormat("responses-gateway")).toBe("openai");

      await post(app, { id: "claude-proxy", name: "Proxy", prefix: "cp", type: "anthropic-compatible", baseUrl: "https://cp.test/v1" });
      expect(isAnthropicCompatibleProvider("claude-proxy")).toBe(true);
      expect((await app.request("/api/provider-nodes/claude-proxy", { method: "DELETE" })).status).toBe(200);
      expect(isAnthropicCompatibleProvider("claude-proxy")).toBe(false);
    } finally {
      instance.close();
    }
  });

  test("rejects malformed, reserved, built-in and duplicate ids", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const base = { name: "Node", prefix: "node", type: "openai-compatible", apiType: "chat", baseUrl: "https://node.test/v1" };
      expect((await post(app, { ...base, id: "Provider Hakim" })).status).toBe(400);
      expect((await post(app, { ...base, id: "-hakim" })).status).toBe(400);
      expect((await post(app, { ...base, id: "new" })).status).toBe(400);
      expect((await post(app, { ...base, id: "openai" })).status).toBe(400);
      expect((await post(app, { ...base, id: "provider-hakim" })).status).toBe(201);
      const duplicate = await post(app, { ...base, id: "provider-hakim" });
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toEqual({ error: 'ID "provider-hakim" is already in use' });
    } finally {
      instance.close();
    }
  });

  test("keeps generating a prefixed id when none is given", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await post(app, { name: "Embed", prefix: "emb", type: "custom-embedding", baseUrl: "https://emb.test/v1" });
      expect((await created.json()).node.id).toStartWith("custom-embedding-");
    } finally {
      instance.close();
    }
  });
});

describe("provider node logo", () => {
  const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const json = (body: Record<string, unknown>) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const base = { id: "logo-node", name: "Logo", prefix: "logo", type: "openai-compatible", apiType: "chat", baseUrl: "https://logo.test/v1" };
  const edit = { name: "Logo", prefix: "logo", apiType: "chat", baseUrl: "https://logo.test/v1" };

  test("stores the logo in node data, keeps it on unrelated edits and removes it on null", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      expect((await app.request("/api/provider-nodes", { method: "POST", ...json({ ...base, logo: LOGO }) })).status).toBe(201);
      expect(instance.repos.nodes.get("logo-node")?.logo).toBe(LOGO);

      await app.request("/api/provider-nodes/logo-node", { method: "PUT", ...json({ ...edit, name: "Renamed" }) });
      expect(instance.repos.nodes.get("logo-node")).toMatchObject({ name: "Renamed", logo: LOGO });

      await app.request("/api/provider-nodes/logo-node", { method: "PUT", ...json({ ...edit, logo: null }) });
      expect(instance.repos.nodes.get("logo-node")?.logo).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("rejects a logo that is not a base64 image data URL or is too large", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const remote = await app.request("/api/provider-nodes", { method: "POST", ...json({ ...base, logo: "https://logo.test/logo.png" }) });
      expect(remote.status).toBe(400);
      const html = await app.request("/api/provider-nodes", { method: "POST", ...json({ ...base, logo: "data:text/html;base64,PGgxPg==" }) });
      expect(html.status).toBe(400);
      const smuggled = await app.request("/api/provider-nodes", { method: "POST", ...json({ ...base, data: { logo: "data:text/html;base64,PGgxPg==" } }) });
      expect(smuggled.status).toBe(201);
      expect(instance.repos.nodes.get("logo-node")?.logo).toBeUndefined();
      const large = await app.request("/api/provider-nodes/logo-node", { method: "PUT", ...json({ ...edit, logo: `data:image/png;base64,${"A".repeat(200_000)}` }) });
      expect(large.status).toBe(400);
      expect(await large.json()).toEqual({ error: "Logo is too large" });
    } finally {
      instance.close();
    }
  });
});
