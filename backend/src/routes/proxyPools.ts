import { Hono } from "hono";
import type { Runtime } from "../runtime";

function view(pool: Record<string, unknown>): Record<string, any> {
  const data = typeof pool.data === "string" ? JSON.parse(pool.data) as Record<string, unknown> : (pool.data as Record<string, unknown> || {});
  return { ...pool, ...data, isActive: pool.isActive === 1 || pool.isActive === true };
}

// Relay worker source deployed to Cloudflare.
const CLOUDFLARE_RELAY_WORKER_CODE = `
export default {
  async fetch(request, env, ctx) {
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";

    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      newRequestInit.body = request.body;
      newRequestInit.duplex = "half";
    }

    newRequestInit.headers.delete("x-relay-target");
    newRequestInit.headers.delete("x-relay-path");
    newRequestInit.headers.delete("host");

    try {
      const response = await fetch(targetUrl, newRequestInit);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
`;

// Relay function source deployed to Vercel.
const VERCEL_RELAY_FUNCTION_CODE = `
export const config = { runtime: "edge" };

export default async function handler(req) {
  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;

  const headers = new Headers(req.headers);
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    duplex: "half",
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
`;

const VERCEL_API = "https://api.vercel.com";

async function pollVercelDeployment(deploymentId: string, token: string, maxMs = 120_000): Promise<{ url?: string }> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const response = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json() as { readyState?: string; url?: string };
    if (data.readyState === "READY") return data;
    if (data.readyState === "ERROR" || data.readyState === "CANCELED") throw new Error(`Deployment failed: ${data.readyState}`);
    await new Promise<any>((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Deployment timed out");
}

const DENO_V2_API = "https://api.deno.com/v2";

const DENO_RELAY_CODE = `Deno.serve(async (request) => {
  const target = request.headers.get("x-relay-target");
  const relayPath = request.headers.get("x-relay-path") || "/";

  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const newHeaders = new Headers(request.headers);
  newHeaders.delete("x-relay-target");
  newHeaders.delete("x-relay-path");
  newHeaders.delete("host");

  const init = {
    method: request.method,
    headers: newHeaders,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl, init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
});`;

export function proxyPoolRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => c.json({ proxyPools: runtime.repos.proxies.list().map(view) }))
    .post("/", async (c) => { const body = await c.req.json<Record<string, unknown>>(); const name = typeof body.name === "string" ? body.name.trim() : ""; const proxyUrl = typeof body.proxyUrl === "string" ? body.proxyUrl.trim() : ""; if (!name) return c.json({ error: "Name is required" }, 400); if (!proxyUrl) return c.json({ error: "Proxy URL is required" }, 400); const type = ["http", "vercel", "cloudflare", "deno"].includes(String(body.type)) ? body.type : "http"; const normalized = { ...body, name, proxyUrl, type, isActive: body.isActive === undefined ? true : body.isActive === true, strictProxy: body.strictProxy === true }; return c.json({ proxyPool: view(runtime.repos.proxies.create({ ...normalized, data: normalized })) }, 201); })
    .get("/:id", (c) => { const pool = runtime.repos.proxies.get(c.req.param("id")); return pool ? c.json(view(pool)) : c.json({ error: "Proxy pool not found" }, 404); })
    .put("/:id", async (c) => { const pool = runtime.repos.proxies.update(c.req.param("id"), await c.req.json<Record<string, unknown>>()); return pool ? c.json(view(pool)) : c.json({ error: "Proxy pool not found" }, 404); })
    .delete("/:id", (c) => runtime.repos.proxies.remove(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Proxy pool not found" }, 404))
    .post("/cloudflare-deploy", async (c) => {
      try {
        const body = await c.req.json<{ accountId?: string; apiToken?: string; projectName?: string }>();
        const accountId = body.accountId?.trim();
        const apiToken = body.apiToken?.trim();
        const projectName = body.projectName?.trim() || `relay-${Date.now().toString(36)}`;
        if (!accountId || !apiToken) return c.json({ error: "Cloudflare Account ID and API Token are required" }, 400);

        const workerScriptUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${projectName}`;
        // Cloudflare requires multipart/form-data for worker script upload.
        const formData = new FormData();
        formData.append("index.js", new Blob([CLOUDFLARE_RELAY_WORKER_CODE], { type: "application/javascript+module" }), "index.js");
        formData.append("metadata", new Blob([JSON.stringify({ main_module: "index.js", compatibility_date: "2024-03-20", observability: { enabled: true } })], { type: "application/json" }), "metadata.json");

        const uploadResponse = await fetch(workerScriptUrl, { method: "PUT", headers: { authorization: `Bearer ${apiToken}` }, body: formData });
        if (!uploadResponse.ok) {
          const err = await uploadResponse.json().catch(() => ({} as { errors?: Array<{ message?: string }> }));
          return c.json({ error: err.errors?.[0]?.message || "Failed to upload Worker to Cloudflare" }, uploadResponse.status as 400);
        }

        // Enable the workers.dev subdomain; failure is not fatal.
        await fetch(`${workerScriptUrl}/subdomain`, { method: "POST", headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });

        let deployUrl = "";
        const subdomainResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" } });
        if (subdomainResponse.ok) {
          const subdomainData = await subdomainResponse.json() as { result?: { subdomain?: string } };
          if (subdomainData.result?.subdomain) deployUrl = `https://${projectName}.${subdomainData.result.subdomain}.workers.dev`;
        }
        if (!deployUrl) {
          return c.json({ error: "Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have setup a workers.dev subdomain in Cloudflare Dashboard." }, 400);
        }

        const proxyPool = view(runtime.repos.proxies.create({ name: projectName, proxyUrl: deployUrl, type: "cloudflare", noProxy: "", isActive: true, strictProxy: false, data: { name: projectName, proxyUrl: deployUrl, type: "cloudflare", noProxy: "", isActive: true, strictProxy: false } }));
        return c.json({ proxyPool, deployUrl }, 201);
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Deploy failed" }, 500);
      }
    })
    .post("/vercel-deploy", async (c) => {
      try {
        const body = await c.req.json<{ vercelToken?: string; projectName?: string }>();
        const vercelToken = body.vercelToken;
        const projectName = body.projectName?.trim() || `relay-${Date.now().toString(36)}`;
        if (!vercelToken) return c.json({ error: "Vercel API token is required" }, 400);

        const deployResponse = await fetch(`${VERCEL_API}/v13/deployments`, {
          method: "POST",
          headers: { authorization: `Bearer ${vercelToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            name: projectName,
            files: [
              { file: "api/relay.js", data: VERCEL_RELAY_FUNCTION_CODE },
              { file: "package.json", data: JSON.stringify({ name: projectName, version: "1.0.0" }) },
              { file: "vercel.json", data: JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/api/relay" }] }) },
            ],
            projectSettings: { framework: null },
            target: "production",
          }),
        });
        if (!deployResponse.ok) {
          const err = await deployResponse.json().catch(() => ({} as { error?: { message?: string } }));
          return c.json({ error: err.error?.message || "Failed to create Vercel deployment" }, deployResponse.status as 400);
        }

        const deployment = await deployResponse.json() as { id?: string; uid?: string; projectId?: string };
        const deploymentId = deployment.id || deployment.uid || "";

        // Disable deployment protection (Vercel Authentication).
        const projectId = deployment.projectId || projectName;
        await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${vercelToken}`, "content-type": "application/json" },
          body: JSON.stringify({ ssoProtection: null }),
        });

        const ready = await pollVercelDeployment(deploymentId, vercelToken);
        const deployUrl = `https://${ready.url}`;
        const proxyPool = view(runtime.repos.proxies.create({ name: projectName, proxyUrl: deployUrl, type: "vercel", noProxy: "", isActive: true, strictProxy: false, data: { name: projectName, proxyUrl: deployUrl, type: "vercel", noProxy: "", isActive: true, strictProxy: false } }));
        return c.json({ proxyPool, deployUrl }, 201);
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Deploy failed" }, 500);
      }
    })
    .post("/deno-deploy", async (c) => {
      try {
        const body = await c.req.json<{ denoToken?: string; orgDomain?: string; projectName?: string }>();
        const denoToken = body.denoToken?.trim();
        const orgDomain = body.orgDomain?.trim();
        const projectName = body.projectName?.trim() || `relay-${Date.now().toString(36)}`;
        if (!orgDomain) return c.json({ error: "Organization domain is required" }, 400);
        if (!denoToken) return c.json({ error: "Deno Deploy API token is required" }, 400);

        const headers: Record<string, any> = { authorization: `Bearer ${denoToken}`, "content-type": "application/json" };
        const createAppResponse = await fetch(`${DENO_V2_API}/apps`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            slug: projectName,
            labels: { "custom.kind": "lobakai-relay" },
            config: { install: "deno install", runtime: { type: "dynamic", entrypoint: "main.ts" } },
          }),
        });
        if (!createAppResponse.ok) {
          const text = await createAppResponse.text().catch(() => "");
          if (createAppResponse.status === 409) return c.json({ error: `App "${projectName}" already exists. Choose a different name.` }, 409);
          return c.json({ error: `Failed to create app (${createAppResponse.status}): ${text}` }, createAppResponse.status as 400);
        }
        const app = await createAppResponse.json() as { id: string };

        const deployResponse = await fetch(`${DENO_V2_API}/apps/${app.id}/deploy`, {
          method: "POST",
          headers,
          body: JSON.stringify({ assets: { "main.ts": { kind: "file", content: DENO_RELAY_CODE, encoding: "utf-8" } } }),
        });
        if (!deployResponse.ok) {
          const text = await deployResponse.text().catch(() => "");
          await fetch(`${DENO_V2_API}/apps/${app.id}`, { method: "DELETE", headers: { authorization: `Bearer ${denoToken}` } }).catch(() => {});
          return c.json({ error: `Deploy failed (${deployResponse.status}): ${text}` }, deployResponse.status as 400);
        }

        const revision = await deployResponse.json() as { id?: string; status?: string };
        let status = revision.status;
        let attempts = 0;
        const maxAttempts = 30; // 30 * 2s = 60s max
        while (status === "queued" || status === "building") {
          if (attempts >= maxAttempts) throw new Error("Deploy timed out after 60 seconds");
          await new Promise<any>((resolve) => setTimeout(resolve, 2000));
          const statusResponse = await fetch(`${DENO_V2_API}/revisions/${revision.id}`, { headers: { authorization: `Bearer ${denoToken}` } });
          if (!statusResponse.ok) break;
          const statusData = await statusResponse.json() as { status?: string };
          status = statusData.status;
          attempts += 1;
        }
        if (status !== "succeeded") {
          await fetch(`${DENO_V2_API}/apps/${app.id}`, { method: "DELETE", headers: { authorization: `Bearer ${denoToken}` } }).catch(() => {});
          return c.json({ error: `Deploy failed with status: ${status}` }, 500);
        }

        const orgSlug = orgDomain.split(".")[0];
        const deployUrl = `https://${projectName}.${orgSlug}.deno.net`;
        const proxyPool = view(runtime.repos.proxies.create({ name: projectName, proxyUrl: deployUrl, type: "deno", noProxy: "", isActive: true, strictProxy: false, data: { name: projectName, proxyUrl: deployUrl, type: "deno", noProxy: "", isActive: true, strictProxy: false } }));
        return c.json({ proxyPool, deployUrl }, 201);
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Deploy failed" }, 500);
      }
    })
    .post("/:id/test", async (c) => {
      const pool = runtime.repos.proxies.get(c.req.param("id"));
      if (!pool) return c.json({ error: "Proxy pool not found" }, 404);
      const value = view(pool);
      const startedAt = Date.now();
      try {
        const response = await fetch("https://httpbin.org/get", { headers: { "x-proxy-url": String(value.proxyUrl || "") }, signal: AbortSignal.timeout(10_000) });
        const testedAt = new Date().toISOString();
        runtime.repos.proxies.update(String(pool.id), { isActive: response.ok, testStatus: response.ok ? "active" : "error", data: { ...value, lastTestedAt: testedAt, lastError: response.ok ? null : `Proxy test failed with status ${response.status}` } });
        return c.json({ ok: response.ok, status: response.status, statusText: response.statusText || null, error: response.ok ? null : `Proxy test failed with status ${response.status}`, elapsedMs: Date.now() - startedAt, testedAt });
      } catch (error: any) {
        const testedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : String(error);
        runtime.repos.proxies.update(String(pool.id), { isActive: false, testStatus: "error", data: { ...value, lastTestedAt: testedAt, lastError: message } });
        return c.json({ ok: false, status: 500, statusText: null, error: message, elapsedMs: Date.now() - startedAt, testedAt });
      }
    });
}
