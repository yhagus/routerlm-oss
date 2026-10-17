import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-usage-trend-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("usage trend and entity filters", () => {
  test("trend rejects unknown dimensions and periods", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      expect((await app.request("/api/usage/trend?by=bogus")).status).toBe(400);
      expect((await app.request("/api/usage/trend?by=provider&period=bogus")).status).toBe(400);
    } finally {
      instance.close();
    }
  });

  test("trend splits tokens per provider and groups the tail as Other", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      for (const [provider, tokens] of [["claude", 300], ["gemini", 200], ["openai", 100]] as const) {
        instance.repos.usage.record({ provider, model: "m", promptTokens: tokens, completionTokens: 0 });
      }
      const body = await (await app.request("/api/usage/trend?by=provider&period=7d&top=2")).json();
      expect(body.labels).toHaveLength(7);
      expect(body.series.map((item: { id: string }) => item.id)).toEqual(["claude", "gemini", "__other__"]);
      const other = body.series.find((item: { id: string }) => item.id === "__other__");
      expect(other.tokens.reduce((a: number, b: number) => a + b, 0)).toBe(100);
    } finally {
      instance.close();
    }
  });

  test("api key trend never exposes the raw key value", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const created = await (await app.request("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "ci" }) })).json();
      const raw = String(created.key);
      instance.repos.usage.record({ provider: "claude", model: "m", apiKey: raw, promptTokens: 10, completionTokens: 0 });
      const text = await (await app.request("/api/usage/trend?by=apiKey&period=7d")).text();
      expect(text).not.toContain(raw);
      expect(JSON.parse(text).series[0].id).toBe(created.id);
    } finally {
      instance.close();
    }
  });

  test("overview validates the period and returns aligned buckets", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      expect((await app.request("/api/usage/overview?period=bogus")).status).toBe(400);
      instance.repos.usage.record({ provider: "claude", model: "sonnet", promptTokens: 100, completionTokens: 50, cost: 0.5 });
      instance.repos.usage.record({ provider: "claude", model: "sonnet", promptTokens: 10, completionTokens: 5, cost: 0.1, status: "error" });
      instance.repos.usage.record({ provider: "gemini", model: "flash", promptTokens: 20, completionTokens: 10, cost: 0.2 });
      const body = await (await app.request("/api/usage/overview?period=24h")).json();
      expect(body.labels).toHaveLength(24);
      expect(body.buckets).toHaveLength(24);
      expect(body.totals.requests).toBe(3);
      expect(body.totals.failed).toBe(1);
      expect(body.totals.tokens).toBe(195);
      expect(body.totals.successRate).toBeCloseTo(2 / 3, 5);
      // The buckets must add up to the totals, or the chart and the cards disagree.
      expect(body.buckets.reduce((sum: number, bucket: { requests: number }) => sum + bucket.requests, 0)).toBe(3);
      expect(body.buckets.reduce((sum: number, bucket: { failed: number }) => sum + bucket.failed, 0)).toBe(1);
      expect(body.peak.requests).toBe(3);
      expect(body.costByProvider[0].id).toBe("claude");
      expect(body.costByProvider[0].cost).toBeCloseTo(0.6, 5);
      expect(body.models[0].id).toBe("claude/sonnet");
      expect(body.models[0].requests).toBe(2);
      // Everything was recorded just now, so the window before it is empty.
      expect(body.previous.requests).toBe(0);
      expect(body.previous.successRate).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("overview has no previous window for all time", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const body = await (await app.request("/api/usage/overview?period=all")).json();
      expect(body.previous).toBeNull();
      expect(body.totals.successRate).toBeNull();
      expect(body.peak).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("public stats activity only covers the requesting key", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const post = async (name: string) => (await app.request("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) })).json();
      const mine = await post("mine");
      const other = await post("other");
      instance.repos.usage.record({ provider: "claude", model: "sonnet", apiKey: String(mine.key), promptTokens: 40, completionTokens: 10 });
      instance.repos.usage.record({ provider: "gemini", model: "flash", apiKey: String(other.key), promptTokens: 9000, completionTokens: 1000 });
      const body = await (await app.request(`/api/public/stats?apikey=${encodeURIComponent(String(mine.key))}`)).json();
      expect(body.activity.labels).toHaveLength(7);
      const total = body.activity.series.reduce((sum: number, item: { tokens: number[] }) => sum + item.tokens.reduce((a, b) => a + b, 0), 0);
      expect(total).toBe(50);
      expect(JSON.stringify(body.activity)).not.toContain("gemini");
      expect(JSON.stringify(body)).not.toContain(String(other.key));
    } finally {
      instance.close();
    }
  });

  test("request details filter by outcome", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const details = (await (await app.request("/api/usage/request-details?outcome=bogus")).json()).details;
      expect(Array.isArray(details)).toBe(true);
      expect((await app.request("/api/usage/request-details?outcome=error&search=cla%25")).status).toBe(200);
    } finally {
      instance.close();
    }
  });

  test("api key list filters by status and paginates after filtering", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      expect((await app.request("/api/usage/api-keys?status=bogus")).status).toBe(400);
      const body = await (await app.request("/api/usage/api-keys?status=paused&sort=tokens")).json();
      expect(body.keys.every((key: { isActive: boolean }) => key.isActive === false)).toBe(true);
      expect(body.pagination.totalItems).toBe(body.keys.length);
    } finally {
      instance.close();
    }
  });
});
