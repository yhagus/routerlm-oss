import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-deploys-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

describe("v1 proxy pool deploy routes", () => {
  test("cloudflare deploy uploads the worker, resolves the subdomain, and creates the pool", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const invalid = await app.request("/api/proxy-pools/cloudflare-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "Cloudflare Account ID and API Token are required" });

      const calls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method || "GET"} ${url}`);
        if (url.includes("/workers/scripts/relay-prod") && !url.includes("subdomain")) {
          expect((init?.headers as Record<string, string>).authorization).toBe("Bearer cf-token");
          expect(init?.body).toBeInstanceOf(FormData);
          return jsonResponse({ success: true });
        }
        if (url.includes("/subdomain") && init?.method === "POST") return jsonResponse({ success: true });
        if (url.includes("/workers/subdomain")) return jsonResponse({ result: { subdomain: "acme" } });
        throw new Error(`unexpected fetch ${url}`);
      }) as unknown as typeof fetch;

      const deployed = await app.request("/api/proxy-pools/cloudflare-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: "acct-1", apiToken: "cf-token", projectName: "relay-prod" }) });
      expect(deployed.status).toBe(201);
      const payload = await deployed.json();
      expect(payload.deployUrl).toBe("https://relay-prod.acme.workers.dev");
      expect(payload.proxyPool.proxyUrl).toBe("https://relay-prod.acme.workers.dev");
      expect(payload.proxyPool.type).toBe("cloudflare");
      expect(payload.proxyPool.isActive).toBe(true);
      expect(calls[0]).toContain("PUT https://api.cloudflare.com/client/v4/accounts/acct-1/workers/scripts/relay-prod");
    } finally {
      instance.close();
    }
  });

  test("vercel deploy polls the deployment and creates the pool", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const invalid = await app.request("/api/proxy-pools/vercel-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "Vercel API token is required" });

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v13/deployments") && init?.method === "POST") {
          const body = JSON.parse(String(init?.body));
          expect(body.files.some((file: { file: string }) => file.file === "api/relay.js")).toBe(true);
          return jsonResponse({ id: "dpl-1", projectId: "prj-1" });
        }
        if (url.includes("/v9/projects/prj-1")) return jsonResponse({ ssoProtection: null });
        if (url.includes("/v13/deployments/dpl-1")) return jsonResponse({ readyState: "READY", url: "relay-vercel.vercel.app" });
        throw new Error(`unexpected fetch ${url}`);
      }) as unknown as typeof fetch;

      const deployed = await app.request("/api/proxy-pools/vercel-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vercelToken: "vc-token", projectName: "relay-vercel" }) });
      expect(deployed.status).toBe(201);
      const payload = await deployed.json();
      expect(payload.deployUrl).toBe("https://relay-vercel.vercel.app");
      expect(payload.proxyPool.type).toBe("vercel");
    } finally {
      instance.close();
    }
  });

  test("deno deploy validates input, handles name conflicts, and creates the pool", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const missingDomain = await app.request("/api/proxy-pools/deno-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ denoToken: "tok" }) });
      expect(missingDomain.status).toBe(400);
      expect(await missingDomain.json()).toEqual({ error: "Organization domain is required" });

      const missingToken = await app.request("/api/proxy-pools/deno-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgDomain: "acme.deno.com" }) });
      expect(missingToken.status).toBe(400);
      expect(await missingToken.json()).toEqual({ error: "Deno Deploy API token is required" });

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/apps") && init?.method === "POST") {
          if (String(init?.body).includes('"taken"')) return jsonResponse({ error: "conflict" }, 409);
          return jsonResponse({ id: "app-1" });
        }
        if (url.includes("/apps/app-1/deploy")) return jsonResponse({ id: "rev-1", status: "queued" });
        if (url.includes("/revisions/rev-1")) return jsonResponse({ status: "succeeded" });
        throw new Error(`unexpected fetch ${url}`);
      }) as unknown as typeof fetch;

      const conflict = await app.request("/api/proxy-pools/deno-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ denoToken: "tok", orgDomain: "acme.deno.com", projectName: "taken" }) });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({ error: 'App "taken" already exists. Choose a different name.' });

      const deployed = await app.request("/api/proxy-pools/deno-deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ denoToken: "tok", orgDomain: "acme.deno.com", projectName: "relay-deno" }) });
      expect(deployed.status).toBe(201);
      const payload = await deployed.json();
      expect(payload.deployUrl).toBe("https://relay-deno.acme.deno.net");
      expect(payload.proxyPool.type).toBe("deno");
    } finally {
      instance.close();
    }
  });
});
