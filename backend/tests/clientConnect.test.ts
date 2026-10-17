import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-client-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("v1 connect routes", () => {
  test("connect exposes only the default public key and its usable combos", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const empty = await app.request("/api/connect");
      expect(await empty.json()).toEqual({ basePath: "/v1", keys: [], combos: [] });

      instance.repos.combos.create({ name: "allowed", kind: "fallback", models: ["claude/claude-sonnet"] });
      instance.repos.combos.create({ name: "secret", models: ["glm/glm-5"] });
      const created = instance.repos.keys.create({ name: "Public Key", visibility: "public", isDefault: true, comboAccessList: ["secret"], comboAccessMode: "blacklist" });
      instance.repos.keys.create({ name: "Private Key" });

      const payload = await (await app.request("/api/connect")).json();
      expect(payload.basePath).toBe("/v1");
      expect(payload.keys).toEqual([{
        id: created.record.id,
        name: "Public Key",
        key: created.key,
        limitMode: "none",
        limitValue: null,
        usageRequests: 0,
        usageTokens: 0,
      }]);
      expect(payload.combos).toEqual([{ name: "allowed", kind: "fallback" }]);
    } finally {
      instance.close();
    }
  });

  test("connect usage aggregates per-combo model usage with cache headers", async () => {
    const instance = await runtime();
    try {
      const created = instance.repos.keys.create({ name: "Public Key", visibility: "public", isDefault: true });
      instance.repos.combos.create({ name: "main", models: ["claude/claude-sonnet", "glm/glm-5"] });
      instance.repos.combos.create({ name: "other", models: ["kimi/kimi-latest"] });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", apiKey: created.record.key, promptTokens: 100, completionTokens: 50 });
      instance.repos.usage.record({ provider: "glm", model: "glm-5", apiKey: created.record.key, promptTokens: 10, completionTokens: 5 });

      const app = createApp(instance);
      const first = await app.request("/api/connect/usage");
      expect(first.headers.get("x-connect-usage-cache")).toBe("miss");
      expect(first.headers.get("cache-control")).toContain("max-age=60");
      const payload = await first.json();
      expect(payload.models).toEqual([
        { model: "main", inputTokens: 110, outputTokens: 55 },
        { model: "other", inputTokens: 0, outputTokens: 0 },
      ]);
      expect(typeof payload.updatedAt).toBe("string");

      const second = await app.request("/api/connect/usage");
      expect(second.headers.get("x-connect-usage-cache")).toBe("hit");
      expect(await second.json()).toEqual(payload);
    } finally {
      instance.close();
    }
  });
});
