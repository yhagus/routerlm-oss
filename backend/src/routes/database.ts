import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { exportDatabase, importDatabase } from "../services/platform/databaseBackup";

export function databaseRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => {
      const password = c.req.header("x-lobak-password");
      if (!c.req.header("x-lobak-cli-token") && password !== undefined) {
        // Password re-authentication is handled by the dashboard session in v1.
        // The admin middleware already verified the dashboard session here.
      }
      return c.json(exportDatabase(runtime));
    })
    .post("/", async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const { password: _password, ...payload } = body;
      try {
        importDatabase(runtime, payload);
        return c.json({ success: true });
      } catch (error: any) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to import database" }, 400);
      }
    });
}
