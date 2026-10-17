import { describe, expect, spyOn, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime(env: Record<string, string> = {}) {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-runtime-stats-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
    ...env,
  }));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blockEventLoop(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) { /* hold the event loop */ }
}

type RuntimeStats = {
  eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; samples: number; sinceMs: number };
  memory: { rssBytes: number; peakRssBytes: number };
  slowQueries: { thresholdMs: number | null; count: number };
};

async function stats(app: ReturnType<typeof createApp>): Promise<RuntimeStats> {
  const response = await app.request("/api/usage/runtime-stats");
  expect(response.status).toBe(200);
  return await response.json() as RuntimeStats;
}

describe("runtime stats", () => {
  test("report event-loop lag after a synchronous block and clear it on reset", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      await wait(50);
      blockEventLoop(150);
      await wait(50);

      const blocked = await stats(app);
      expect(blocked.eventLoop.maxMs).toBeGreaterThanOrEqual(140);
      expect(blocked.eventLoop.p99Ms).toBeGreaterThanOrEqual(140);

      expect((await app.request("/api/usage/runtime-stats/reset", { method: "POST" })).status).toBe(200);
      await wait(50);
      const cleared = await stats(app);
      expect(cleared.eventLoop.maxMs).toBeLessThan(100);
      expect(cleared.memory.peakRssBytes).toBeGreaterThanOrEqual(cleared.memory.rssBytes / 2);
    } finally {
      instance.close();
    }
  });

  test("log one line per SQLite query slower than the configured threshold", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const slowLines = () => warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("[SQLite] slow query"));
    const strict = await runtime({ SLOW_QUERY_MS: "0.0001" });
    const relaxed = await runtime();
    const disabled = await runtime({ SLOW_QUERY_MS: "0" });
    try {
      warn.mockClear();
      expect((await createApp(relaxed).request("/api/usage/stats?period=7d")).status).toBe(200);
      expect((await createApp(disabled).request("/api/usage/stats?period=7d")).status).toBe(200);
      expect(slowLines()).toEqual([]);

      expect((await createApp(strict).request("/api/usage/stats?period=7d")).status).toBe(200);
      const lines = slowLines();
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((line) => /^\[SQLite\] slow query \d+\.\dms: SELECT .*FROM usageHistory/.test(line))).toBe(true);
      const strictStats = (await stats(createApp(strict))).slowQueries;
      expect(strictStats.thresholdMs).toBe(0.0001);
      // The count also covers boot queries that ran before the log capture started.
      expect(strictStats.count).toBeGreaterThanOrEqual(lines.length);
      expect((await stats(createApp(disabled))).slowQueries).toEqual({ thresholdMs: null, count: 0 });
    } finally {
      warn.mockRestore();
      strict.close();
      relaxed.close();
      disabled.close();
    }
  });
});
