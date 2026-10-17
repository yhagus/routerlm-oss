import { Hono } from "hono";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const healthRoutes = new Hono()
  .get("/", (context) => context.json({ ok: true }, 200, CORS_HEADERS))
  .options("/", (context) => context.body(null, 204, CORS_HEADERS));
