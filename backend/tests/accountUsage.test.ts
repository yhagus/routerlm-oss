import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-account-usage-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("account usage detail", () => {
  test("by-account detail returns totals, models, and recent requests", async () => {
    const instance = await runtime();
    try {
      const connection = instance.repos.providers.create({
        provider: "claude",
        authType: "oauth",
        credentials: { accessToken: "at-1" },
      });
      const app = createApp(instance);

      const response = await app.request(`/api/usage/by-account/${connection.id}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        totalRequests: 0,
        byModel: [],
        recentRequests: [],
      });
    } finally {
      instance.close();
    }
  });

  test("by-account detail rejects invalid periods", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const response = await app.request("/api/usage/by-account/some-id?period=nope");
      expect(response.status).toBe(400);
    } finally {
      instance.close();
    }
  });
});
