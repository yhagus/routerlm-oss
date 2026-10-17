import { Hono } from "hono";
import type { Context } from "hono";
import type { Runtime } from "../runtime";
// v1 headroom runtime: binary/python discovery, detached proxy process,
// pip extras. detect.js is fully pure; process.js only needs dataDir.
import { DEFAULT_HEADROOM_URL, findHeadroomBinary, findPython310, getHeadroomStatus as probeHeadroom, getInstalledHeadroomExtras, isLoopbackHeadroomUrl, probeProxyRunning } from "../services/platform/headroom/detect.ts";
import { getManagedPid, installHeadroomExtras, uninstallHeadroomExtras, startHeadroomProxy, stopHeadroomProxy, restartHeadroomProxy, getHeadroomLogTail, getInstallLogTail } from "../services/platform/headroom/process.ts";

function headroomSettings(runtime: Runtime) {
  const settings = runtime.repos.settings.get() as Record<string, unknown>;
  return {
    url: String(settings.headroomUrl || DEFAULT_HEADROOM_URL),
    codeAware: settings.headroomCodeAware === true,
    kompress: settings.headroomKompress !== false,
  };
}

async function fullStatus(runtime: Runtime) {
  const { url } = headroomSettings(runtime);
  const binary = findHeadroomBinary();
  const python = findPython310();
  const running = await probeProxyRunning(url);
  const extras = python ? getInstalledHeadroomExtras(python) : {};
  const { version } = await probeHeadroom(url);
  return {
    installed: Boolean(binary),
    path: binary,
    running,
    python,
    localUrl: url,
    canStart: Boolean(binary) && isLoopbackHeadroomUrl(url),
    version,
    extras,
    url,
    managedPid: getManagedPid(),
  };
}

export function headroomRoutes(runtime: Runtime) {
  const start = async (c: Context) => {
    try {
      const { url, codeAware, kompress } = headroomSettings(runtime);
      if (!isLoopbackHeadroomUrl(url)) return c.json({ error: "Remote headroomUrl cannot be started locally", code: "EXTERNAL_PROXY" }, 400);
      if (!findHeadroomBinary()) return c.json({ error: "headroom binary not found — install with `pip install headroom-ai[proxy]`", code: "NOT_INSTALLED" }, 400);
      const port = Number(new URL(url).port || 8787);
      const result = await startHeadroomProxy({ port, codeAware, kompress }) as { pid?: number; alreadyRunning?: boolean };
      return c.json({ success: true, pid: result?.pid ?? null, alreadyRunning: Boolean(result?.alreadyRunning) });
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Headroom start failed" }, 500);
    }
  };

  const stop = async (c: Context) => {
    try {
      const pid = getManagedPid();
      const stopped = stopHeadroomProxy();
      return stopped ? c.json({ stopped: true, pid }) : c.json({ stopped: false, reason: "not_running" }, 409);
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "Headroom stop failed" }, 500);
    }
  };

  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/status", async (c) => {
      try {
        return c.json(await fullStatus(runtime));
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Headroom status failed" }, 500);
      }
    })
    .post("/start", start)
    .post("/restart", async (c) => {
      try {
        const { url, codeAware, kompress } = headroomSettings(runtime);
        if (!isLoopbackHeadroomUrl(url)) return c.json({ error: "Remote headroomUrl cannot be started locally", code: "EXTERNAL_PROXY" }, 400);
        const port = Number(new URL(url).port || 8787);
        await restartHeadroomProxy({ port, codeAware, kompress });
        return c.json(await fullStatus(runtime));
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Headroom restart failed" }, 500);
      }
    })
    .post("/stop", stop)
    .get("/extras", async (c) => {
      if (c.req.query("log") === "1") return c.json({ log: getInstallLogTail(50) });
      return c.json({ available: ["code", "ml"], ...(await fullStatus(runtime)) });
    })
    .post("/extras", async (c) => {
      try {
        const body = await c.req.json<{ extras?: string[] }>();
        const extras = Array.isArray(body.extras) ? body.extras : [];
        if (!findHeadroomBinary()) return c.json({ error: "headroom is not installed", code: "NOT_INSTALLED" }, 400);
        const python = findPython310();
        if (!python) return c.json({ error: "Python 3.10+ not found", code: "NO_PYTHON" }, 400);
        await installHeadroomExtras(extras);
        const status = await fullStatus(runtime);
        return c.json({ success: true, code: null, spec: extras.join(","), extras: status.extras, installed: status.installed, version: status.version });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Extras install failed" }, 500);
      }
    })
    .delete("/extras", async (c) => {
      try {
        const body = await c.req.json<{ extras?: string[] }>();
        const extras = Array.isArray(body.extras) ? body.extras : [];
        const python = findPython310();
        if (!python) return c.json({ error: "Python 3.10+ not found", code: "NO_PYTHON" }, 400);
        if (!extras.every((extra) => ["code", "ml"].includes(extra))) return c.json({ error: "Invalid extras", code: "INVALID_EXTRAS" }, 400);
        const removed = await uninstallHeadroomExtras(extras) as string[];
        const status = await fullStatus(runtime);
        return c.json({ success: true, code: null, removed, extras: getInstalledHeadroomExtras(python), installed: status.installed, version: status.version });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Extras removal failed" }, 500);
      }
    })
    .all("/proxy/*", async (c) => {
      // Byte-preserving reverse proxy to the headroom process; the dashboard
      // HTML gets its fetch() calls rewritten to this proxy prefix.
      const { url } = headroomSettings(runtime);
      const path = c.req.path.replace(/^\/api\/headroom\/proxy\/?/, "/");
      const target = `${url.replace(/\/$/, "")}${path}${new URL(c.req.url).search}`;
      const headers = new Headers();
      c.req.raw.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization", "te"].includes(lower)) return;
        if (!isLoopbackHeadroomUrl(url) && (lower === "cookie" || lower === "authorization")) return;
        headers.set(key, value);
      });
      try {
        const upstream = await fetch(target, {
          method: c.req.method,
          headers,
          body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
          redirect: "manual",
          duplex: "half",
        } as any);
        if (path === "/dashboard" || path.startsWith("/dashboard/")) {
          const text = await upstream.text();
          const rewritten = text
            .replace(/fetch\((['"])\/stats\b/g, "fetch($1/api/headroom/proxy/stats")
            .replace(/fetch\((['"])\/health\b/g, "fetch($1/api/headroom/proxy/health")
            .replace(/fetch\((['"])\/stats-history\b/g, "fetch($1/api/headroom/proxy/stats-history")
            .replace(/fetch\((['"])\/transformations\/feed\b/g, "fetch($1/api/headroom/proxy/transformations/feed");
          return new Response(rewritten, { status: upstream.status, headers: upstream.headers });
        }
        return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Headroom proxy failed" }, 500);
      }
    });
}
