import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { clearFreeTrackerCache } from "../src/services/billing/freeTracker";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: "/tmp/lobakai-v2-contract-tests",
    REQUIRE_LOGIN: "false",
  }));
}

describe("v2 dashboard contracts", () => {
  test("persists pricing overrides and resets them by model", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const patch = await app.request("/api/pricing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openai: { "gpt-test": { input: 1, output: 2 } } }),
      });
      expect(patch.status).toBe(200);
      expect((await patch.json()).openai["gpt-test"].input).toBe(1);

      const get = await app.request("/api/pricing");
      expect((await get.json()).openai["gpt-test"]).toEqual({ input: 1, output: 2 });

      const reset = await app.request("/api/pricing?provider=openai&model=gpt-test", { method: "DELETE" });
      expect(reset.status).toBe(200);
      expect((await reset.json()).openai).toBeUndefined();
    } finally {
      instance.close();
    }
  });

  test("aggregates usage by provider and API key across dashboard routes", async () => {
    const instance = await runtime();
    try {
      const key = instance.repos.keys.create({ key: "sk-contract", keyHash: "contract-hash", name: "Contract key" });
      instance.repos.usage.record({ provider: "openai", model: "gpt-4o", apiKey: key.record.key, promptTokens: 10, completionTokens: 5, tokens: { prompt_tokens: 10, completion_tokens: 5 } });
      const app = createApp(instance);

      const dashboard = await app.request("/api/usage/dashboard?period=today");
      expect((await dashboard.json()).totals.requests).toBe(1);

      const chart = await app.request("/api/usage/chart?period=7d");
      expect((await chart.json())).toHaveLength(7);

      const providers = await app.request("/api/usage/providers");
      expect((await providers.json()).providers).toContainEqual({ id: "openai", name: "OpenAI" });

      const byProvider = await app.request("/api/usage/by-provider?period=all");
      expect((await byProvider.json()).providers[0].usage.totalTokens).toBe(15);

      const apiKeys = await app.request("/api/usage/api-keys?period=all");
      const payload = await apiKeys.json();
      expect(payload.keys[0].usage.totalTokens).toBe(15);
      expect(payload.keys[0].key).toBe("sk-contract...");
    } finally {
      instance.close();
    }
  });

  test("returns actual free-tracker sources and persists visibility", async () => {
    const instance = await runtime();
    const originalFetch = globalThis.fetch;
    clearFreeTrackerCache();
    globalThis.fetch = (async (input) => {
      if (String(input).includes("inferhub.dev")) {
        return new Response("<h2>Example free</h2><div>free/example/model</div>", { status: 200 });
      }
      return Response.json({ keys: [{ quota_credits: 100, remaining_credits: 75, status: "active" }] });
    }) as typeof fetch;
    try {
      const app = createApp(instance);
      const feed = await app.request("/api/free-tracker");
      expect(feed.status).toBe(200);
      expect((await feed.json()).sources.length).toBe(2);

      const patch = await app.request("/api/free-tracker", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: "inferhub", publicVisible: true }),
      });
      expect((await patch.json()).freeTrackerPublic).toEqual({ inferhub: true });
    } finally {
      globalThis.fetch = originalFetch;
      clearFreeTrackerCache();
      instance.close();
    }
  });

  test("returns an empty grouped quota tracker when no eligible accounts exist", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const response = await app.request("/api/quota");
      const payload = await response.json();
      expect(payload.providers).toEqual([]);
    } finally {
      instance.close();
    }
  });

  test("persists Combo Detail account filters and custom account order", async () => {
    const instance = await runtime();
    try {
      const combo = instance.repos.combos.create({ name: "account-route", models: ["openai/gpt-test"] });
      const app = createApp(instance);
      const response = await app.request(`/api/combos/${combo.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountFilters: { "openai/gpt-test": ["account-b", "account-a"] }, useCustomAccountOrder: true }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.accountFilters).toEqual({ "openai/gpt-test": ["account-b", "account-a"] });
      expect(payload.useCustomAccountOrder).toBe(true);
    } finally {
      instance.close();
    }
  });
});
