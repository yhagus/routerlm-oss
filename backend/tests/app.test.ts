import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";

const app = createApp();

describe("GET /api/health", () => {
  test("matches the legacy health response contract", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("*");
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("OPTIONS /api/health", () => {
  test("matches the legacy health preflight contract", async () => {
    const response = await app.request("/api/health", { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("*");
    expect(await response.text()).toBe("");
  });
});

describe("GET /api/init", () => {
  test("matches the legacy initialization response contract", async () => {
    const response = await app.request("/api/init");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("Initialized");
  });
});

describe("routing defaults", () => {
  test("does not route unsupported health methods", async () => {
    const response = await app.request("/api/health", { method: "POST" });

    expect(response.status).toBe(404);
  });

  test("returns Hono's default response for unknown routes", async () => {
    const response = await app.request("/unknown");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 Not Found");
  });
});
