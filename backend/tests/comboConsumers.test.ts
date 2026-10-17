import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: "/tmp/lobakai-v2-combo-consumers",
    REQUIRE_LOGIN: "false",
  }));
}

describe("combo consumers endpoint", () => {
  test("updates each key's comboAccessList according to its mode", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const combo = instance.repos.combos.create({ name: "team-combo", models: ["openai/gpt-test"] });
      const blacklistAllowed = instance.repos.keys.create({ name: "BL allowed", key: "sk-bl-allowed" }).record;
      instance.repos.keys.create({ name: "BL blocked", key: "sk-bl-blocked", comboAccessMode: "blacklist", comboAccessList: ["team-combo"] });
      const whitelistBlocked = instance.repos.keys.create({ name: "WL blocked", key: "sk-wl-blocked", comboAccessMode: "whitelist", comboAccessList: [] }).record;
      const whitelistAllowed = instance.repos.keys.create({ name: "WL allowed", key: "sk-wl-allowed", comboAccessMode: "whitelist", comboAccessList: ["team-combo"] }).record;

      const response = await app.request(`/api/combos/${combo.id}/consumers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyIds: [blacklistAllowed.id, whitelistBlocked.id] }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).updated).toBe(2);

      const keys = new Map(instance.repos.keys.list().map((key) => [key.name, key]));
      expect(keys.get("BL allowed")?.comboAccessList).not.toContain("team-combo");
      expect(keys.get("BL blocked")?.comboAccessList).toContain("team-combo");
      expect(keys.get("WL blocked")?.comboAccessList).toContain("team-combo");
      expect(keys.get("WL allowed")?.comboAccessList).not.toContain("team-combo");
    } finally {
      instance.close();
    }
  });

  test("returns 404 for a missing combo", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const response = await app.request("/api/combos/missing/consumers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyIds: [] }),
      });
      expect(response.status).toBe(404);
    } finally {
      instance.close();
    }
  });
});
