import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-public-stats-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("public stats page privacy", () => {
  test("logs and activity show combo or bare model names, never the provider behind them", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await (await app.request("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "public" }) })).json();
      const key = String(created.key);
      instance.repos.usage.record({ provider: "secret-upstream", model: "vendor/glm-5", connectionId: "conn-hidden", apiKey: key, promptTokens: 10, completionTokens: 5, meta: { comboName: "smart" } });
      instance.repos.usage.record({ provider: "secret-upstream", model: "vendor/kimi-k2", connectionId: "conn-hidden", apiKey: key, promptTokens: 20, completionTokens: 5, status: "error: upstream secret-upstream refused" });

      const response = await app.request(`/api/public/stats?apikey=${encodeURIComponent(key)}`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("secret-upstream");
      expect(text).not.toContain("conn-hidden");
      expect(text).not.toContain("vendor/");

      const body = JSON.parse(text);
      const logs = body.recentRequests.map((row: { model: string; isCombo: boolean; success: boolean }) => [row.model, row.isCombo, row.success]);
      expect(logs).toContainEqual(["smart", true, true]);
      expect(logs).toContainEqual(["kimi-k2", false, false]);
      expect(body.activity.series.map((item: { id: string }) => item.id).sort()).toEqual(["kimi-k2", "smart"]);
    } finally {
      instance.close();
    }
  });
});
