import { Hono } from "hono";
import type { Runtime } from "../runtime";

function unavailable(plugin: string) {
  return {
    error: `The v2 MCP stdio bridge is not available for ${plugin}`,
    capability: {
      id: "mcp-local-bridge",
      available: false,
      reason: "v2 does not spawn or supervise local MCP processes",
    },
  };
}

export function mcpRoutes(runtime: Runtime) {
  const app = new Hono();
  app.use("*", runtime.auth.adminMiddleware());
  app.get("/:plugin/sse", (c) => c.json(unavailable(c.req.param("plugin")), 501));
  app.post("/:plugin/message", (c) => c.json(unavailable(c.req.param("plugin")), 501));
  return app;
}
