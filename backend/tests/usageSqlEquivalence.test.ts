// Pins every dashboard Usage response for one fixed set of recorded requests.
// The snapshots were written by the JavaScript aggregation that loaded all raw
// rows. The SQL aggregation must return the same totals and series.
process.env.TZ = "Asia/Kolkata";

import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { createApp } from "../src/app";
import type { Runtime } from "../src/runtime";
import { AGGREGATE_PATHS, NOW, RAW_ROW_PATHS, createFixtureRuntime } from "./usageFixture";

const PATHS = [...AGGREGATE_PATHS, ...RAW_ROW_PATHS];

describe("dashboard Usage responses for a fixed data set", () => {
  let runtime: Runtime;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    setSystemTime(new Date(NOW));
    runtime = await createFixtureRuntime("usage-sql");
    app = createApp(runtime);
  });

  afterAll(() => {
    runtime?.close();
    setSystemTime();
  });

  test("summary counts every row in the period", async () => {
    const body = await (await app.request("/api/usage/stats?period=all")).json();
    expect(body).toEqual({ requests: 16, prompt_tokens: 3701, completion_tokens: 1224, cost: 17.875, cached_tokens: 150, total_tokens: 4925 });
  });

  test.each(PATHS)("GET %s", async (path) => {
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchSnapshot();
  });
});
