import { Hono } from "hono";
import type { Runtime } from "../runtime";
// The v1 MITM subsystem is CJS with injectable DB hooks; pointing those hooks
// at the v2 settings repo makes the whole manager usable as-is.
import { getMitmStatus, startServer, stopServer, enableToolDNS, disableToolDNS, trustCert, getCachedPassword, setCachedPassword, loadEncryptedPassword, isSudoPasswordRequired, initDbHooks } from "../services/platform/mitm/manager.ts";
import { writeAliasForTool } from "../services/platform/mitmAliasCache.ts";

const isWin = process.platform === "win32";

function checkIsAdmin(): boolean {
  if (isWin) {
    try {
      require("node:child_process").execSync("net session >nul 2>&1", { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function normalizeMitmRouterBaseUrlInput(input: unknown, fallback: string): string {
  if (input == null || String(input).trim() === "") return fallback;
  const trimmed = String(input).trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid MITM router URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MITM router URL must use http or https");
  }
  return trimmed;
}

function mitmAliases(runtime: Runtime): Record<string, Record<string, string>> {
  const rows = runtime.sqlite.query("SELECT key, value FROM kv WHERE scope = 'mitmAlias'").all() as Array<{ key: string; value: string }>;
  const aliases: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    try { aliases[row.key] = JSON.parse(row.value); } catch { aliases[row.key] = {}; }
  }
  return aliases;
}

function setMitmAlias(runtime: Runtime, tool: string, mappings: Record<string, string>): void {
  runtime.sqlite.query("INSERT INTO kv (scope, key, value) VALUES ('mitmAlias', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(tool, JSON.stringify(mappings));
}

export function mitmRoutes(runtime: Runtime) {
  // Redirect the CJS manager's settings access onto the v2 settings repo.
  initDbHooks(() => runtime.repos.settings.get(), (patch: Record<string, unknown>) => runtime.repos.settings.update(patch));
  const defaultRouterBase = `http://localhost:${runtime.config.port || 20129}`;

  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", async (c) => {
      try {
        const status = await getMitmStatus();
        const settings = runtime.repos.settings.get() as Record<string, unknown>;
        const hasCachedPassword = Boolean(getCachedPassword()) || Boolean(await loadEncryptedPassword());
        return c.json({
          running: status.running,
          pid: status.pid || null,
          certExists: status.certExists || false,
          certTrusted: status.certTrusted || false,
          dnsStatus: status.dnsStatus || {},
          hasCachedPassword,
          isWin,
          needsSudoPassword: !isWin && !hasCachedPassword && isSudoPasswordRequired(),
          isAdmin: checkIsAdmin(),
          mitmRouterBaseUrl: String(settings.mitmRouterBaseUrl || "").trim() || defaultRouterBase,
        });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to get MITM status" }, 500);
      }
    })
    .post("/", async (c) => {
      try {
        const body = await c.req.json<{ apiKey?: string; sudoPassword?: string; mitmRouterBaseUrl?: string; forceKillPort443?: boolean }>();
        const pwd = body.sudoPassword || getCachedPassword() || await loadEncryptedPassword() || "";
        if (!body.apiKey || (!isWin && !pwd && isSudoPasswordRequired())) {
          return c.json({ error: !body.apiKey ? "Missing apiKey" : "Missing sudoPassword" }, 400);
        }
        if (!checkIsAdmin() && (isWin || (isSudoPasswordRequired() && !pwd))) {
          return c.json({ error: isWin ? "Administrator required — restart LobakAI as Administrator" : "Root or sudo password required to start MITM" }, 403);
        }
        if (body.mitmRouterBaseUrl !== undefined && body.mitmRouterBaseUrl !== null) {
          try {
            runtime.repos.settings.update({ mitmRouterBaseUrl: normalizeMitmRouterBaseUrlInput(body.mitmRouterBaseUrl, defaultRouterBase) });
          } catch (error: any) {
            return c.json({ error: error instanceof Error ? error.message : "Invalid MITM router URL" }, 400);
          }
        }
        const result = await startServer(body.apiKey, pwd, body.forceKillPort443 === true);
        if (!isWin) setCachedPassword(pwd);
        return c.json({ success: true, running: result.running, pid: result.pid });
      } catch (error: any) {
        const failure = error as { code?: string; portOwner?: unknown; message?: string };
        if (failure.code === "PORT_443_BUSY") {
          return c.json({ error: failure.message, code: "PORT_443_BUSY", portOwner: failure.portOwner }, 409);
        }
        return c.json({ error: failure.message || "Failed to start MITM server" }, 500);
      }
    })
    .delete("/", async (c) => {
      try {
        const body = await c.req.json<{ sudoPassword?: string }>().catch(() => ({}) as { sudoPassword?: string });
        const pwd = body.sudoPassword || getCachedPassword() || await loadEncryptedPassword() || "";
        if (!isWin && !pwd && isSudoPasswordRequired()) return c.json({ error: "Missing sudoPassword" }, 400);
        await stopServer(pwd);
        if (!isWin && body.sudoPassword) setCachedPassword(body.sudoPassword);
        return c.json({ success: true, running: false });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to stop MITM server" }, 500);
      }
    })
    .patch("/", async (c) => {
      try {
        const body = await c.req.json<{ tool?: string; action?: string; sudoPassword?: string }>();
        const pwd = body.sudoPassword || getCachedPassword() || await loadEncryptedPassword() || "";
        if (!body.tool || !body.action) return c.json({ error: "tool and action required" }, 400);
        if (!["enable", "disable", "trust-cert"].includes(body.action)) return c.json({ error: "Invalid action" }, 400);
        if (!isWin && !pwd && isSudoPasswordRequired()) return c.json({ error: "Missing sudoPassword" }, 400);
        if (body.action === "trust-cert") {
          const certTrusted = await trustCert(pwd);
          return c.json({ success: true, certTrusted });
        }
        const dnsStatus = body.action === "enable" ? await enableToolDNS(body.tool, pwd) : await disableToolDNS(body.tool, pwd);
        if (!isWin && body.sudoPassword) setCachedPassword(body.sudoPassword);
        return c.json({ success: true, dnsStatus });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to update MITM" }, 500);
      }
    })
    .get("/alias", (c) => {
      const tool = c.req.query("tool");
      const aliases = mitmAliases(runtime);
      return c.json({ aliases: tool ? { [tool]: aliases[tool] || {} } : aliases });
    })
    .put("/alias", async (c) => {
      try {
        const body = await c.req.json<{ tool?: string; mappings?: Record<string, string> }>();
        if (!body.tool || typeof body.mappings !== "object") return c.json({ error: "tool and mappings required" }, 400);
        const status = await getMitmStatus();
        const dnsStatus = (status.dnsStatus || {}) as Record<string, boolean>;
        if (!dnsStatus[body.tool]) {
          return c.json({ error: `DNS must be enabled for ${body.tool} before editing model mappings` }, 403);
        }
        const filtered = Object.fromEntries(Object.entries(body.mappings as Record<string, any>).filter(([, model]) => typeof model === "string" && model.trim()));
        setMitmAlias(runtime, body.tool, filtered);
        writeAliasForTool(body.tool, filtered);
        return c.json({ success: true });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to update alias" }, 500);
      }
    });
}
