import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { cliToolConfig, CLI_TOOL_IDS, isCliToolId } from "../services/platform/cliToolGeneration";
import { getCliToolStatus, patchCliTool, resetCliTool } from "../services/platform/cliTools";
import { fetchMcpRegistry, probeMcp } from "../services/platform/mcp";

export function cliToolRoutes(runtime: Runtime) {
  const app = new Hono();
  app.use("*", runtime.auth.adminMiddleware());

  app.get("/all-statuses", async (c) => c.json(Object.fromEntries(await Promise.all(CLI_TOOL_IDS.map(async (tool) => [tool, await getCliToolStatus(tool)] as const)))));

  app.get("/catalog", async (c) => c.json({ data: await Promise.all(CLI_TOOL_IDS.map(async (id) => ({ id, status: await getCliToolStatus(id) }))) }));

  app.get("/cowork-mcp-registry", async (c) => {
    try {
      return c.json(await fetchMcpRegistry(c.req.query("refresh") === "1"));
    } catch (error: any) {
      return c.json({ error: error instanceof Error ? error.message : "MCP registry request failed", servers: [] as any[], total: 0 }, 500);
    }
  });

  app.post("/cowork-mcp-tools", async (c) => {
    const body: { url?: unknown } = await c.req.json<{ url?: unknown }>().catch(() => ({} as { url?: unknown }));
    if (!body.url) return c.json({ error: "url required" }, 400);
    const result = await probeMcp(body.url);
    return c.json(result, typeof result.error === "string" && result.error.includes("required") ? 400 : 200);
  });

  app.all("/:tool-settings", async (c) => {
    const routeName = c.req.param("tool-settings");
    const toolName = routeName.endsWith("-settings") ? routeName.slice(0, -"-settings".length) : "";
    if (!isCliToolId(toolName)) return c.json({ error: "CLI tool not found" }, 404);
    const tool = toolName;

    if (c.req.method === "GET") return c.json(await getCliToolStatus(tool));
    if (c.req.method === "POST") {
      if (tool === "devin") return c.json({ success: false, error: "Devin has no portable v2 configuration writer", capability: { available: false, reason: "client_managed_auth" } }, 501);
      const result = await cliToolConfig(tool, await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>)), runtime);
      if ("error" in result) return c.json({ error: result.error }, 400);
       return c.json({ success: true, generated: true, applied: result.persisted, persisted: result.persisted, message: "Configuration generated and written to the local config path; reload the client to use it.", configPath: result.configPath, config: result.config, content: result.content, models: result.models, activeModel: result.activeModel, capability: { canGenerate: true, canApplyLocally: true, localFilePersistence: result.persisted, reason: "client_reload_required" } });
    }
    if (c.req.method === "PATCH") return c.json({ ...(await patchCliTool(tool, await c.req.json<Record<string, any>>().catch(() => ({})))), applied: true, capability: { canApplyLocally: true, localFilePersistence: true } });
    if (c.req.method === "DELETE") return c.json(await resetCliTool(tool, c.req.query("model")));
    return c.json({ error: "Method not allowed" }, 405);
  });

  return app;
}
