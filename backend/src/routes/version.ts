import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { requestShutdown } from "../services/platform/shutdown";
import { currentVersion, killAppProcesses } from "../services/platform/appProcesses";
import { defaultDataDir } from "../services/platform/dataDir.ts";

// v1 keeps these routes token-gated even when requireLogin is disabled.
function alwaysProtected(runtime: Runtime) {
  return runtime.auth.alwaysProtectedMiddleware();
}

export function versionRoutes(runtime: Runtime) {
  return new Hono()
    .get("/", (c) => c.json({ currentVersion: currentVersion() }))
    .post("/shutdown", alwaysProtected(runtime), (c) => {
      killAppProcesses(runtime.config.dataDir || defaultDataDir()).catch(() => { /* best effort */ });
      const response = c.json({ success: true, message: "Shutting down for manual update..." });
      requestShutdown("manual update", 500);
      return response;
    });
}

export function shutdownRoutes(runtime: Runtime) {
  return new Hono()
    .post("/", alwaysProtected(runtime), (c) => {
      if (process.env.NODE_ENV === "production") {
        return c.json({ success: false, message: "Not allowed in production" }, 403);
      }
      const secret = process.env.SHUTDOWN_SECRET;
      const authorization = c.req.header("authorization");
      if (!secret || authorization !== `Bearer ${secret}`) {
        return c.json({ success: false, message: "Unauthorized" }, 401);
      }
      const response = c.json({ success: true, message: "Shutting down..." });
      requestShutdown("shutdown route", 500);
      return response;
    });
}
