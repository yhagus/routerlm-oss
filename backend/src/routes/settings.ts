import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { applyOutboundProxyEnv } from "../services/platform/network/outboundProxy.ts";
import { configureQuotaAutoPing } from "../services/billing/quotaAutoPing";
import { configureAutoclawTasks } from "../services/billing/autoclawTasksScheduler";
import { configureCodebuddyProbe } from "../services/providers/codebuddyProbeScheduler";

async function hashPassword(value: string): Promise<string> {
  return Bun.password.hash(value, { algorithm: "bcrypt", cost: 10 });
}

async function passwordMatches(value: string, expected: unknown): Promise<boolean> {
  if (typeof expected !== "string") return false;
  if (expected.startsWith("$2")) return Bun.password.verify(value, expected);
  if (expected.startsWith("sha256:")) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return expected === `sha256:${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return false;
}

function safeSettings(runtime: Runtime) {
  const settings = { ...runtime.repos.settings.get() };
  const password = settings.password ?? settings.passwordHash;
  delete settings.passwordHash;
  delete settings.password;
  delete settings.oidcClientSecret;
  delete settings.providerSettings;
  delete settings.zedSystemId;
  return {
    ...settings,
    oidcConfigured: Boolean(settings.oidcIssuerUrl && settings.oidcClientId && runtime.repos.settings.get().oidcClientSecret),
    hasPassword: Boolean(password),
    databasePath: runtime.config.databasePath,
  };
}

export function settingsRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(safeSettings(runtime));
    })
    .patch("/", async (c) => {
      const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      delete body.password;
      delete body.passwordHash;
      if (typeof body.newPassword === "string") {
        const current = runtime.repos.settings.get();
        const currentHash = current.passwordHash ?? current.password;
        if (currentHash && !(await passwordMatches(String(body.currentPassword || ""), currentHash))) {
          return c.json({ error: "Invalid current password" }, 401);
        }
        body.passwordHash = await hashPassword(body.newPassword);
        delete body.newPassword;
        delete body.currentPassword;
      } else {
        delete body.currentPassword;
      }
      const next = runtime.repos.settings.update(body);
      configureQuotaAutoPing(runtime, next as Record<string, any>);
      configureAutoclawTasks(runtime, next as Record<string, any>);
      configureCodebuddyProbe(runtime, next as Record<string, any>);
      // v1 reapplies the outbound proxy env when any proxy key is patched.
      if (Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
          Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
          Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")) {
        applyOutboundProxyEnv(runtime.repos.settings.get() as Record<string, unknown>);
      }
      c.header("Cache-Control", "no-store");
      return c.json(safeSettings(runtime));
    })
    .get("/database", (c) => {
      const tables = ["settings", "providerConnections", "providerNodes", "proxyPools", "apiKeys", "combos", "kv"];
      const data = Object.fromEntries(tables.map((table) => [table, runtime.sqlite.query(`SELECT * FROM ${table}`).all()]));
      return c.json({ version: 2, exportedAt: new Date().toISOString(), data });
    })
    .post("/database", async (c) => {
      const body = await c.req.json<{ password?: string; data?: Record<string, unknown[]> }>().catch(() => ({} as { password?: string; data?: Record<string, unknown[]> }));
      const settings = runtime.repos.settings.get();
      if (typeof settings.passwordHash === "string" && settings.passwordHash !== await hashPassword(String(body.password || ""))) return c.json({ error: "Invalid password" }, 401);
      const imported = body.data?.settings?.[0] as { data?: string } | undefined;
      if (imported?.data) runtime.sqlite.query("UPDATE settings SET data = ? WHERE id = 1").run(imported.data);
      return c.json({ success: true });
    })
    .post("/proxy-test", async (c) => {
      const body = await c.req.json<{ testUrl?: string }>().catch(() => ({} as { testUrl?: string }));
      const started = Date.now();
      try {
        const response = await fetch(body.testUrl || "https://www.google.com/generate_204", { signal: AbortSignal.timeout(10000) });
        return c.json({ ok: response.ok, status: response.status, elapsedMs: Date.now() - started });
      } catch (error: any) {
        return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    })
    .get("/require-login", (c) => c.json({ requireLogin: runtime.repos.settings.get().requireLogin }));
}
