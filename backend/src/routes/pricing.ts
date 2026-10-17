import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { validatePricing, type PricingMap } from "../services/billing/pricing";

export function pricingRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => c.json(runtime.repos.pricing.get()))
    .patch("/", async (c) => {
      const body = await c.req.json<unknown>().catch(() => null);
      const error = validatePricing(body);
      if (error) return c.json({ error }, 400);
      return c.json(runtime.repos.pricing.update(body as PricingMap));
    })
    .delete("/", (c) => c.json(runtime.repos.pricing.reset(c.req.query("provider") || undefined, c.req.query("model") || undefined)));
}
