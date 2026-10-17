import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({ BACKEND_HOST: "127.0.0.1", BACKEND_DATABASE_PATH: ":memory:", DATA_DIR: "/tmp/lobakai-v2-callback-tests", REQUIRE_LOGIN: "false" }));
}

describe("OAuth callback proxy lifecycle", () => {
  test("rejects unsupported callback lifecycle providers", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      expect((await app.request("/api/oauth/claude/start-proxy")).status).toBe(400);
      expect((await app.request("/api/oauth/codex/poll-status")).status).toBe(400);
    } finally {
      instance.close();
    }
  });
});
