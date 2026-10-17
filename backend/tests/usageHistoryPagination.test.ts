import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-usage-history-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

type HistoryPage = { items: Array<Record<string, unknown>>; nextCursor: string | null };

describe("Usage history pagination", () => {
  test("paging through history returns every row once, newest first", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      // "tie-a" and "tie-b" share one timestamp. They come in write order.
      const rows: Array<[string, string]> = [
        ["oldest", "2026-01-01T00:00:00.000Z"],
        ["newest", "2026-01-05T00:00:00.000Z"],
        ["tie-a", "2026-01-03T00:00:00.000Z"],
        ["tie-b", "2026-01-03T00:00:00.000Z"],
        ["middle", "2026-01-02T00:00:00.000Z"],
        ["recent", "2026-01-04T00:00:00.000Z"],
        ["second", "2026-01-01T12:00:00.000Z"],
      ];
      for (const [model, timestamp] of rows) instance.repos.usage.record({ provider: "openai", model, timestamp, promptTokens: 1, completionTokens: 1 });

      const seen: string[] = [];
      const pageSizes: number[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const query = new URLSearchParams({ limit: "3", ...(cursor ? { cursor } : {}) });
        const response = await app.request(`/api/usage/history?${query}`);
        expect(response.status).toBe(200);
        const page = await response.json() as HistoryPage;
        pageSizes.push(page.items.length);
        seen.push(...page.items.map((item) => String(item.model)));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(["newest", "recent", "tie-a", "tie-b", "middle", "second", "oldest"]);
      expect(pageSizes).toEqual([3, 3, 1]);
    } finally {
      instance.close();
    }
  });

  test("a page that holds the last row returns a null cursor", async () => {
    const instance = await runtime();
    try {
      const app = createApp(instance);
      for (const day of [1, 2]) instance.repos.usage.record({ provider: "openai", model: `m${day}`, timestamp: `2026-01-0${day}T00:00:00.000Z`, promptTokens: 1 });
      const page = await (await app.request("/api/usage/history?limit=2")).json() as HistoryPage;
      expect(page.items.map((item) => item.model)).toEqual(["m2", "m1"]);
      expect(page.nextCursor).toBeNull();
    } finally {
      instance.close();
    }
  });

  test("an invalid cursor returns 400", async () => {
    const instance = await runtime();
    try {
      const response = await createApp(instance).request("/api/usage/history?cursor=not-a-cursor");
      expect(response.status).toBe(400);
    } finally {
      instance.close();
    }
  });
});
