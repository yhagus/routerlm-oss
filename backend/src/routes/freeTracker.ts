import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { buildFreeTrackerSources, INFERHUB_URL } from "../services/billing/freeTracker";

export function freeTrackerRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", async (c) => {
      try {
        const data = await buildFreeTrackerSources(runtime.repos.settings.get());
        c.header("Cache-Control", "no-store");
        return c.json(data);
      } catch (error: any) {
        c.header("Cache-Control", "no-store");
        return c.json({ error: error instanceof Error ? error.message : "Failed to fetch free model quotas", sources: [] as any[], pools: [] as any[], source: "free-tracker", sourceUrl: INFERHUB_URL }, 502);
      }
    })
    .patch("/", async (c) => {
      const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
      const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
      if (!sourceId) return c.json({ error: "sourceId is required" }, 400);
      if (typeof body.publicVisible !== "boolean") return c.json({ error: "publicVisible must be a boolean" }, 400);
      const current = runtime.repos.settings.get().freeTrackerPublic;
      const visibility = current && typeof current === "object" && !Array.isArray(current) ? { ...current as Record<string, unknown> } : {};
      if (body.publicVisible) visibility[sourceId] = true;
      else delete visibility[sourceId];
      const next = runtime.repos.settings.update({ freeTrackerPublic: visibility });
      c.header("Cache-Control", "no-store");
      return c.json({ sourceId, publicVisible: body.publicVisible, freeTrackerPublic: next.freeTrackerPublic || {} });
    });
}
