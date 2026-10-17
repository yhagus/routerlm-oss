import { afterEach, describe, expect, test } from "bun:test";
import { canonicalizeUsage } from "../src/services/common/usageTracking.ts";
import { getPricingForModel as v1GetPricingForModel, calculateCostFromTokens as v1CalculateCost, PROVIDER_PRICING as v1ProviderPricing, formatCost as v1FormatCost } from "../src/services/billing/providerPricing.js";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import type { Runtime } from "../src/runtime";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

async function runtime(): Promise<Runtime> {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-usagecanon-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

// Fixtures written by the gateway/chat paths: RAW upstream usage objects that
// must be converted to the canonical storage convention on write.
const CLAUDE_CACHE_READ = { prompt_tokens: 100, completion_tokens: 50, cache_read_input_tokens: 30 };
const OPENAI_CACHE_READ = { prompt_tokens: 150, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 40 } };
const RESPONSES_CACHE_READ = { input_tokens: 200, output_tokens: 80, input_tokens_details: { cached_tokens: 70 } };
const OLLAMA = { prompt_tokens: 900, completion_tokens: 10, total_tokens: 910 };

describe("usage canonicalization (write-time parity with v1)", () => {
  test("record canonicalizes token envelope identically to v1 canonicalizeUsage", async () => {
    for (const [name, fixture] of Object.entries({ CLAUDE_CACHE_READ, OPENAI_CACHE_READ, RESPONSES_CACHE_READ, OLLAMA })) {
      const instance = await runtime();
      try {
        const expected = canonicalizeUsage(fixture as Record<string, unknown>);
        instance.repos.usage.record({ provider: "test", model: `m-${name}`, tokens: fixture as Record<string, unknown> });
        const row = instance.repos.usage.list(10)[0];
        expect(row, `row for ${name}`).toBeDefined();
        const stored = JSON.parse(String(row!.tokens));
        expect(stored).toEqual(expected);
      } finally {
        instance.close();
      }
    }
  });

  test("Claude cache-read folds cache into prompt and stores top-level cached_tokens", async () => {
    const instance = await runtime();
    try {
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", tokens: CLAUDE_CACHE_READ });
      const row = instance.repos.usage.list(10)[0];
      const tokens = JSON.parse(String(row!.tokens));
      // prompt_tokens is cache-inclusive.
      expect(tokens.prompt_tokens).toBe(130);
      expect(tokens.completion_tokens).toBe(50);
      expect(tokens.cached_tokens).toBe(30);
      // summary sums the canonical prompt column → 130, matching v1.
      const app = createApp(instance);
      const stats = await (await app.request("/api/usage/stats?period=all")).json();
      expect(stats.prompt_tokens).toBe(130);
      expect(stats.completion_tokens).toBe(50);
      expect(stats.cached_tokens).toBe(30);
      // dashboard totals.tokens = prompt + completion = 180 (cache-inclusive prompt).
      const dash = await (await app.request("/api/usage/dashboard?period=all")).json();
      expect(dash.totals.tokens).toBe(180);
    } finally {
      instance.close();
    }
  });

  test("OpenAI/Responses cached read keeps prompt inclusive and lifts cached to top-level", async () => {
    const instance = await runtime();
    try {
      instance.repos.usage.record({ provider: "openai", model: "gpt-4o", tokens: OPENAI_CACHE_READ });
      const row = instance.repos.usage.list(10)[0];
      const tokens = JSON.parse(String(row!.tokens));
      expect(tokens.prompt_tokens).toBe(150);
      expect(tokens.cached_tokens).toBe(40); // lifted from prompt_tokens_details
      const stats = await (await createApp(instance).request("/api/usage/stats?period=all")).json();
      expect(stats.prompt_tokens).toBe(150);
    } finally {
      instance.close();
    }
  });

  test("scalar-only record (no tokens envelope) preserves counts", async () => {
    const instance = await runtime();
    try {
      instance.repos.usage.record({ provider: "claude", model: "m", promptTokens: 12, completionTokens: 34 });
      const row = instance.repos.usage.list(10)[0];
      const tokens = JSON.parse(String(row!.tokens));
      expect(tokens.prompt_tokens).toBe(12);
      expect(tokens.completion_tokens).toBe(34);
      const stats = await (await createApp(instance).request("/api/usage/stats?period=all")).json();
      expect(stats.prompt_tokens).toBe(12);
      expect(stats.completion_tokens).toBe(34);
    } finally {
      instance.close();
    }
  });
});

describe("usage stream carries cached tokens on recent requests", () => {
  test("recentRequests include cachedTokens alongside cache-inclusive prompt", async () => {
    const instance = await runtime();
    try {
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", tokens: CLAUDE_CACHE_READ });
      const stream = await createApp(instance).request("/api/usage/stream");
      expect(stream.status).toBe(200);

      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let recent: Array<Record<string, unknown>> | null = null;
      while (recent === null) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));
          if (Array.isArray(payload.recentRequests) && payload.recentRequests.length) {
            recent = payload.recentRequests;
          }
        }
      }
      await reader.cancel();
      expect(recent).not.toBeNull();
      expect(recent![0]).toMatchObject({ promptTokens: 130, completionTokens: 50, cachedTokens: 30 });
    } finally {
      instance.close();
    }
  });

  test("recentRequests surface the combo name instead of the resolved model", async () => {
    const instance = await runtime();
    try {
      const created = instance.repos.keys.create({ name: "Public", visibility: "public", isDefault: true });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", apiKey: created.key, promptTokens: 10, completionTokens: 5, meta: { comboName: "fast-combo" } });
      const response = await createApp(instance).request(`/api/public/stats?apikey=${created.key}`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(Array.isArray(payload.recentRequests)).toBe(true);
      expect(payload.recentRequests[0]).toMatchObject({ model: "fast-combo", isCombo: true });
      expect(JSON.stringify(payload.recentRequests)).not.toContain("claude-sonnet");
    } finally {
      instance.close();
    }
  });

  test("combos aggregate error rate, average t/s, and success-only latency", async () => {
    const instance = await runtime();
    try {
      const created = instance.repos.keys.create({ name: "Public", visibility: "public", isDefault: true });
      instance.repos.combos.create({ name: "fast-combo", models: ["claude/claude-sonnet"] });
      // 4 requests: 1 failed, 2 successful with metrics, 1 successful WITHOUT
      // metrics (old data). The no-metrics row must not dilute the averages.
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", apiKey: created.key, promptTokens: 10, completionTokens: 100, status: "success", meta: { comboName: "fast-combo", tokensPerSecond: 50, totalMs: 2000 } });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", apiKey: created.key, promptTokens: 10, completionTokens: 50, status: "success", meta: { comboName: "fast-combo", tokensPerSecond: 25, totalMs: 2000 } });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", apiKey: created.key, promptTokens: 10, completionTokens: 80, status: "success", meta: { comboName: "fast-combo" } });
      instance.repos.usage.record({ provider: "claude", model: "claude-sonnet", apiKey: created.key, promptTokens: 10, completionTokens: 0, status: "error", meta: { comboName: "fast-combo" } });

      const response = await createApp(instance).request(`/api/public/stats?apikey=${created.key}`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      const combo = payload.combos.find((c: { name: string }) => c.name === "fast-combo");
      expect(combo).toBeDefined();
      expect(combo.requests).toBe(4);
      expect(combo.completionTokens).toBe(230);
      // 1 failed of 4 -> 25%
      expect(Math.round(combo.errorRate * 100)).toBe(25);
      // (50 + 25) / 2 metric rows = 37.5 t/s (the no-metric row is excluded)
      expect(combo.avgTokensPerSecond).toBe(37.5);
      // (2000 + 2000) / 2 = 2000 ms
      expect(combo.avgLatencyMs).toBe(2000);
    } finally {
      instance.close();
    }
  });
});

describe("cost parity (v2 pricing vs v1 pricing)", () => {
  test("resolveDefaultPricing matches v1 getPricingForModel and cost matches", async () => {
    const v2 = await import("../src/services/billing/pricing");
    // Broad model sample spanning exact models, vendor-prefixed ids, and
    // glob-pattern-only matches (MiniMax case, o3-mini, kimi, qwen).
    const models = [
      "claude-haiku-4.5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929",
      "claude-3-5-sonnet-20241022", "claude-opus-4-6", "gpt-4o", "gpt-4o-mini",
      "gpt-5.2", "gpt-5.3-codex", "deepseek-v4-pro", "deepseek-chat", "MiniMax-M2.5",
      "o3-mini", "qwen3-coder-plus", "gemini-3.6-flash-high", "kimi-k3", "grok-4.5-high",
      "vision-model", "claude-sonnet-5", "deepseek-v4-flash",
    ];
    const fixtures: Array<Record<string, unknown>> = [
      { prompt_tokens: 100, completion_tokens: 20, cache_read_input_tokens: 60 },
      { prompt_tokens: 150, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } },
      { input_tokens: 200, output_tokens: 40, input_tokens_details: { cached_tokens: 150, cache_creation_tokens: 30 } },
      { prompt_tokens: 42, completion_tokens: 7 },
    ];

    let resolved = 0;
    let pricingDiffs = 0;
    let costDiffs = 0;
    for (const model of models) {
      const v1Pricing = v1GetPricingForModel(null, model);
      const v2Pricing = v2.resolveDefaultPricing(null, model);
      if (!v1Pricing && !v2Pricing) continue; // neither resolves — skip
      resolved += 1;
      // Both must resolve the same way (both null → skip; one null → fail).
      if (Boolean(v1Pricing) !== Boolean(v2Pricing)) {
        pricingDiffs += 1;
        continue;
      }
      if (JSON.stringify(v1Pricing) !== JSON.stringify(v2Pricing)) {
        pricingDiffs += 1;
        continue;
      }
      for (const fixture of fixtures) {
        const v1Cost = v1CalculateCost(fixture, v1Pricing as Record<string, unknown>);
        const v2Cost = v2.calculateCostFromTokens(fixture, v2Pricing as Record<string, unknown>);
        if (Math.abs(v1Cost - v2Cost) > 1e-9) costDiffs += 1;
      }
    }
    expect(pricingDiffs, `pricing resolution diffs across ${resolved} models`).toBe(0);
    expect(costDiffs, `cost diffs across ${resolved} models`).toBe(0);
    // Guard: the sample is non-trivially covered.
    expect(resolved).toBeGreaterThan(15);
  });

  test("getDefaultPricing matches v1 PROVIDER_PRICING shape", async () => {
    const v2 = await import("../src/services/billing/pricing");
    const v1Shape = v1ProviderPricing as Record<string, unknown>;
    expect(Object.keys(v2.getDefaultPricing()).sort()).toEqual(Object.keys(v1Shape).sort());
    expect(JSON.stringify(v2.getDefaultPricing())).toEqual(JSON.stringify(v1Shape));
  });

  test("formatCost matches v1", async () => {
    const v2 = await import("../src/services/billing/pricing");
    for (const n of [0, 1, 1.999, 12345.678, null, undefined]) {
      expect(v2.formatCost(n as number)).toBe(v1FormatCost(n as number));
    }
  });
});