import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-grok-damaged-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

describe("grok-cli damaged accounts", () => {
  test("delete-damaged removes only flagged grok-cli accounts", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const make = (provider: string, name: string, data: Record<string, unknown>) =>
        instance.repos.providers.create({ provider, authType: "oauth", name, data } as never).id;
      const flagged = make("grok-cli", "flagged", { probe407DamagedAt: new Date().toISOString() });
      const legacy = make("grok-cli", "legacy", { lastError: "probe-407:damaged" });
      const healthy = make("grok-cli", "healthy", {});
      const other = make("codex", "other", { probe407DamagedAt: new Date().toISOString() });

      const listed = await (await app.request("/api/providers/grok-cli/damaged")).json();
      expect([...listed.ids].sort()).toEqual([flagged, legacy].sort());

      const result = await (await app.request("/api/providers/grok-cli/delete-damaged", { method: "POST" })).json();
      expect([...result.deleted].sort()).toEqual([flagged, legacy].sort());
      expect(result.failed).toEqual([]);
      expect(instance.repos.providers.get(healthy)).not.toBeNull();
      expect(instance.repos.providers.get(other)).not.toBeNull();
      expect(instance.repos.providers.get(flagged)).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("delete-damaged is a no-op when nothing is flagged", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      const result = await (await app.request("/api/providers/grok-cli/delete-damaged", { method: "POST" })).json();
      expect(result).toEqual({ deleted: [], failed: [] });
    } finally {
      instance.close();
    }
  });
});

describe("probe 407 timeout", () => {
  test("normalizeProbeTimeoutMs defaults and clamps", async () => {
    const { normalizeProbeTimeoutMs, DEFAULT_PROBE_TIMEOUT_MS } = await import("../src/services/providers/grokCliProbe407");
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(7000);
    expect(normalizeProbeTimeoutMs(undefined)).toBe(7000);
    expect(normalizeProbeTimeoutMs("abc")).toBe(7000);
    expect(normalizeProbeTimeoutMs(-5)).toBe(7000);
    expect(normalizeProbeTimeoutMs(250)).toBe(1000);
    expect(normalizeProbeTimeoutMs(15000)).toBe(15000);
    expect(normalizeProbeTimeoutMs(999999)).toBe(120000);
  });

  test("normalizeProbeConcurrency defaults, floors and clamps", async () => {
    const { normalizeProbeConcurrency, DEFAULT_PROBE_CONCURRENCY } = await import("../src/services/providers/grokCliProbe407");
    expect(DEFAULT_PROBE_CONCURRENCY).toBe(5);
    expect(normalizeProbeConcurrency(undefined)).toBe(5);
    expect(normalizeProbeConcurrency("abc")).toBe(5);
    expect(normalizeProbeConcurrency(0)).toBe(5);
    expect(normalizeProbeConcurrency(-3)).toBe(5);
    expect(normalizeProbeConcurrency(8.9)).toBe(8);
    expect(normalizeProbeConcurrency(500)).toBe(50);
  });
});
