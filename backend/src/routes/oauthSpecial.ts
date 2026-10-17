import { Hono } from "hono";
import type { Runtime } from "../runtime";
import {
  exportGrokAccounts,
  importCodebuddyIntlCliAccounts,
  importCodexAccessToken,
  importCodexAccounts,
  importGrokAccounts,
  importQoderAccounts,
  redactSecrets,
} from "../services/providers/authSpecial";

type Json = Record<string, unknown>;

async function body(c: { req: { json: <T>() => Promise<T> } }): Promise<Json> {
  return c.req.json<Json>().catch(() => ({}));
}

function error(c: { json: (value: unknown, status?: 400 | 401 | 500) => Response }, value: unknown, status: 400 | 401 | 500 = 400) {
  return c.json({ error: redactSecrets(value) }, status);
}

export function oauthSpecialRoutes(runtime: Runtime) {
  const app = new Hono().use("*", runtime.auth.adminMiddleware());

  app.post("/codex/import-token", async (c) => {
    try { return c.json(importCodexAccessToken(runtime.repos.providers, await body(c))); }
    catch (cause: any) { return error(c, cause); }
  });

  app.post("/codex/bulk-import", async (c) => {
    try { return c.json(importCodexAccounts(runtime.repos.providers, await c.req.json<unknown>())); }
    catch (cause: any) { return error(c, cause); }
  });

  app.get("/grok-cli/export", (c) => {
    const exportData = exportGrokAccounts(runtime.repos.providers);
    return c.json(exportData, 200, { "Content-Disposition": `attachment; filename="grok-cli-accounts-${Date.now()}.json"` });
  });

  app.post("/grok-cli/bulk-import", async (c) => {
    try { return c.json(await importGrokAccounts(runtime.repos.providers, await c.req.json<unknown>())); }
    catch (cause: any) { return error(c, cause); }
  });

  app.post("/codebuddy-intl-cli/bulk-import", async (c) => {
    try { return c.json(await importCodebuddyIntlCliAccounts(runtime.repos.providers, await c.req.json<unknown>())); }
    catch (cause: any) { return error(c, cause); }
  });

  app.post("/qoder/bulk-import", async (c) => {
    try { return c.json(await importQoderAccounts(runtime.repos.providers, await body(c))); }
    catch (cause: any) { return error(c, cause); }
  });

  return app;
}
