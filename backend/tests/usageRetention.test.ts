// Usage retention: the job moves raw Usage rows older than the retention
// period into daily rollups. Dashboard totals and series must not change.
process.env.TZ = "Asia/Kolkata";

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { createApp } from "../src/app";
import type { Runtime } from "../src/runtime";
import { AGGREGATE_PATHS, DAY, NOW, RAW_INSERT, at, createFixtureRuntime } from "./usageFixture";

// NOW is 2026-03-18 21:17 in Asia/Kolkata (UTC+05:30). With 3 retention days
// the raw rows start at the local midnight of 2026-03-15, 2026-03-14T18:30Z.
const CUTOFF = "2026-03-14T18:30:00.000Z";

type Json = any;

async function getJson(app: ReturnType<typeof createApp>, path: string): Promise<Json> {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  return response.json();
}

// Recent request lists show raw rows only. Rolled-up rows leave them.
function withoutRecent(body: Json): Json {
  return JSON.parse(JSON.stringify(body, (key, value) => (key === "recentRequests" ? undefined : value)));
}

async function snapshot(app: ReturnType<typeof createApp>): Promise<Map<string, Json>> {
  const result = new Map<string, Json>();
  for (const path of AGGREGATE_PATHS) result.set(path, await getJson(app, path));
  return result;
}

async function runRetention(app: ReturnType<typeof createApp>): Promise<{ retentionDays: number; moved: number; cutoff: string | null }> {
  const response = await app.request("/api/usage/retention/run", { method: "POST" });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ retentionDays: number; moved: number; cutoff: string | null }>;
}

async function setRetention(app: ReturnType<typeof createApp>, days: number): Promise<void> {
  const response = await app.request("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ usageRetentionDays: days }) });
  expect(response.status).toBe(200);
}

describe("Usage retention", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    setSystemTime(new Date(NOW));
    runtime = await createFixtureRuntime("usage-retention");
    // Two rows on each side of the local midnight that starts 2026-03-15.
    // In UTC both rows fall on 2026-03-14.
    runtime.repos.usage.record({ timestamp: "2026-03-14T18:15:00.000Z", provider: "claude", model: "sonnet", connectionId: "conn-a", apiKey: "sk-fixture-key-a", clientIp: "10.0.0.9", status: "success", cost: 0.5, promptTokens: 11, completionTokens: 7, meta: { comboName: "combo-a", tokensPerSecond: 30, totalMs: 900 } });
    runtime.repos.usage.record({ timestamp: "2026-03-14T18:45:00.000Z", provider: "claude", model: "sonnet", connectionId: "conn-a", apiKey: "sk-fixture-key-a", status: "success", cost: 0.25, promptTokens: 13, completionTokens: 3 });
    // Two rows on each side of the local midnight that starts 2026-03-14.
    // Both fall on 2026-03-13 in UTC and both are older than the cutoff.
    runtime.repos.usage.record({ timestamp: "2026-03-13T18:15:00.000Z", provider: "claude", model: "sonnet", connectionId: "conn-a", status: "success", cost: 0, promptTokens: 4, completionTokens: 2 });
    runtime.repos.usage.record({ timestamp: "2026-03-13T18:45:00.000Z", provider: "claude", model: "sonnet", connectionId: "conn-a", status: "success", cost: 0, promptTokens: 8, completionTokens: 1 });
    runtime.repos.usage.flush();
    app = createApp(runtime);
  });

  afterEach(() => {
    runtime?.close();
    setSystemTime();
  });

  test("the default setting keeps every raw row", async () => {
    const before = await getJson(app, "/api/usage/history?limit=1000");
    expect((await runRetention(app)).moved).toBe(0);
    expect(await getJson(app, "/api/usage/history?limit=1000")).toEqual(before);
  });

  test("dashboard responses stay the same after old rows move into rollups", async () => {
    const before = await snapshot(app);
    const historyBefore = (await getJson(app, "/api/usage/history?limit=1000")).items as Json[];
    expect(historyBefore).toHaveLength(20);

    await setRetention(app, 3);
    // Nine rows are older than the local midnight cutoff, including the row
    // at 23:45 local time on 2026-03-14. The row at 00:15 local time on
    // 2026-03-15 stays raw.
    expect(await runRetention(app)).toEqual({ retentionDays: 3, cutoff: CUTOFF, moved: 9 });

    const history = (await getJson(app, "/api/usage/history?limit=1000")).items as Json[];
    expect(history.map((row) => row.timestamp)).toEqual(historyBefore.map((row) => row.timestamp).filter((timestamp: string) => timestamp >= CUTOFF));
    expect(history.map((row) => row.timestamp)).toContain("2026-03-14T18:45:00.000Z");

    for (const path of AGGREGATE_PATHS) {
      const after = await getJson(app, path);
      expect({ path, body: withoutRecent(after) }).toEqual({ path, body: withoutRecent(before.get(path)) });
      if (Array.isArray(before.get(path).recentRequests)) {
        const kept = before.get(path).recentRequests.filter((row: Json) => row.timestamp >= CUTOFF);
        expect({ path, recent: after.recentRequests.slice(0, kept.length) }).toEqual({ path, recent: kept });
      }
    }
  });

  test("the local day keeps rows on both sides of the UTC date change apart", async () => {
    await setRetention(app, 3);
    await runRetention(app);
    const chart = await getJson(app, "/api/usage/chart?period=7d");
    // Rolled-up days: 2026-03-13 local holds the fixture row from five days
    // ago (10 tokens) and the 23:45 row (6 tokens). 2026-03-14 local holds
    // the 00:15 row (9 tokens), the fixture row from four days ago (150
    // tokens) and the 23:45 row (18 tokens). A UTC day would merge the first
    // pair into one rollup row. Raw day: 2026-03-15 local holds the 00:15
    // row (16 tokens).
    expect(chart.map((bucket: Json) => [bucket.label, bucket.tokens])).toEqual([
      ["Mar 12", 100], ["Mar 13", 16], ["Mar 14", 177], ["Mar 15", 16], ["Mar 16", 1200], ["Mar 17", 500], ["Mar 18", 905],
    ]);
  });

  test("a later run adds new old rows to the rollups and repeats nothing", async () => {
    await setRetention(app, 3);
    await runRetention(app);
    expect((await runRetention(app)).moved).toBe(0);
    const before = await getJson(app, "/api/usage/stats?period=all");
    // A legacy writer stores a row for a day that is already rolled up.
    runtime.sqlite.query(RAW_INSERT).run(at(-45 * DAY + 60_000), "claude", "sonnet", "conn-a", "sk-fixture-key-a", null, null, 20, 5, 1, "success", null, null);
    expect((await runRetention(app)).moved).toBe(1);
    const after = await getJson(app, "/api/usage/stats?period=all");
    expect(after).toEqual({ ...before, requests: before.requests + 1, prompt_tokens: before.prompt_tokens + 20, completion_tokens: before.completion_tokens + 5, total_tokens: before.total_tokens + 25, cost: before.cost + 1 });
    const keyStats = await getJson(app, "/api/usage/api-keys/key-a?period=60d");
    expect(keyStats.byProvider.find((row: Json) => row.provider === "claude").requests).toBe(6);
  });
});
