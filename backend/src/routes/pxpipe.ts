import { Hono } from "hono";
import type { Runtime } from "../runtime";
// v1 PXPIPE library-mode runtime: npm install into DATA_DIR, in-process
// transform module, JSONL event log. All modules are pure apart from dataDir.
import { getInstallInfo, installPxpipe } from "../services/platform/pxpipe/install.ts";
import { loadPxpipe, unloadPxpipe } from "../services/platform/pxpipe/loader.ts";
import { getPxpipeStatus, runHealthCheck } from "../services/platform/pxpipe/service.ts";
import { readPxpipeEvents, getPxpipeStats } from "../services/platform/pxpipe/events.ts";
import { getDataDir } from "../services/platform/dataDir.ts";
import { readText } from "../services/platform/host";

function pxpipeSettings(runtime: Runtime) {
  const settings = runtime.repos.settings.get() as Record<string, unknown>;
  return {
    enabled: settings.pxpipeEnabled === true,
    autoInstall: settings.pxpipeAutoInstall !== false,
    minChars: Number(settings.pxpipeMinChars ?? 25000),
    timeoutMs: Number(settings.pxpipeTimeoutMs ?? 15000),
  };
}

function statusWithSettings(runtime: Runtime) {
  return { ...getPxpipeStatus(), ...pxpipeSettings(runtime) };
}

export function pxpipeRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/status", (c) => c.json(statusWithSettings(runtime)))
    .get("/health", async (c) => c.json(await runHealthCheck()))
    .post("/health", async (c) => c.json(await runHealthCheck()))
    .get("/stats", (c) => c.json(getPxpipeStats({ recentLimit: Math.min(Number(c.req.query("limit")) || 100, 500) })))
    .get("/logs", async (c) => {
      const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
      const events = readPxpipeEvents({ limit });
      const installLog = (await readText(`${getDataDir()}/pxpipe/install.log`)) || "";
      return c.json({ installLog, events });
    })
    .post("/start", async (c) => {
      try {
        if (!getInstallInfo().installed && !pxpipeSettings(runtime).autoInstall) {
          return c.json({ error: "PXPIPE is not installed", code: "NOT_INSTALLED" }, 409);
        }
        if (!getInstallInfo().installed) await installPxpipe();
        await loadPxpipe();
        return c.json(statusWithSettings(runtime));
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "PXPIPE start failed", code: (error as { code?: string }).code || null }, 500);
      }
    })
    .post("/stop", (c) => {
      unloadPxpipe();
      return c.json({ stopped: true, ...statusWithSettings(runtime) });
    })
    .post("/restart", async (c) => {
      try {
        unloadPxpipe();
        if (!getInstallInfo().installed && !pxpipeSettings(runtime).autoInstall) {
          return c.json({ error: "PXPIPE is not installed", code: "NOT_INSTALLED" }, 409);
        }
        if (!getInstallInfo().installed) await installPxpipe();
        await loadPxpipe();
        return c.json(statusWithSettings(runtime));
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "PXPIPE restart failed", code: (error as { code?: string }).code || null }, 500);
      }
    })
    .post("/install", async (c) => {
      try {
        await installPxpipe();
        const install = getInstallInfo();
        return c.json({ installed: install.installed, version: install.version, path: install.path, health: await runHealthCheck() });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "PXPIPE install failed", code: (error as { code?: string }).code || null }, 500);
      }
    });
}

