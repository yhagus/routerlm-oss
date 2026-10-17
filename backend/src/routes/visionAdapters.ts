import { Hono } from "hono";
import type { Runtime } from "../runtime";

export function visionAdapterRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => c.json({ adapters: runtime.repos.visionAdapters.list() }))
    .post("/", async (c) => {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return c.json({ error: "Name is required" }, 400);
      if (!/^[a-zA-Z0-9_.\-: ]+$/.test(name)) return c.json({ error: "Name can only contain letters, numbers, -, _, ., : and spaces" }, 400);
      if (!Array.isArray(body.models)) return c.json({ error: "Models are required" }, 400);
      if (body.models.length === 0) return c.json({ error: "At least one model is required" }, 400);
      try {
        const adapter = runtime.repos.visionAdapters.create({ ...body, name, models: body.models });
        return c.json(adapter, 201);
      } catch {
        return c.json({ error: "Adapter name already exists" }, 400);
      }
    })
    .get("/:id", (c) => {
      const adapter = runtime.repos.visionAdapters.get(c.req.param("id"));
      return adapter ? c.json(adapter) : c.json({ error: "Vision adapter not found" }, 404);
    })
    .put("/:id", async (c) => {
      const body = await c.req.json<Record<string, unknown>>();
      const adapter = runtime.repos.visionAdapters.update(c.req.param("id"), body);
      return adapter ? c.json(adapter) : c.json({ error: "Vision adapter not found" }, 404);
    })
    .delete("/:id", (c) => runtime.repos.visionAdapters.remove(c.req.param("id")) ? c.json({ ok: true }) : c.json({ error: "Vision adapter not found" }, 404))
    .post("/:id/set-global", (c) => {
      const adapter = runtime.repos.visionAdapters.get(c.req.param("id"));
      if (!adapter) return c.json({ error: "Vision adapter not found" }, 404);
      runtime.repos.visionAdapters.setGlobal(c.req.param("id"));
      return c.json({ ok: true });
    })
    .post("/clear-global", (c) => {
      runtime.repos.visionAdapters.clearGlobal();
      return c.json({ ok: true });
    });
}
