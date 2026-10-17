import { Hono } from "hono";

export const initRoutes = new Hono().get("/", (context) => context.text("Initialized"));
