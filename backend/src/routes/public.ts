import { Hono } from "hono";
import type { Runtime } from "../runtime";

export function publicRoutes(runtime: Runtime) {
  return new Hono()
    .get("/tags", (c) => c.json({ models: runtime.gateway.models().map((model) => ({ name: model.id, model: model.id, modified_at: new Date().toISOString(), size: 0, digest: "" })) }))
    .get("/version", (c) => c.json({ version: "2.0.0-dev", updateAvailable: false }))
    .post("/locale", async (c) => { const body = await c.req.json<{ locale?: string }>().catch(() => ({} as { locale?: string })); const locale = body.locale || "en"; return c.json({ locale }, 200, { "Set-Cookie": `locale=${encodeURIComponent(locale)}; SameSite=Lax; Path=/` }); });
}
