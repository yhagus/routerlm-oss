import { describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-stale-refresh-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

type Instance = Awaited<ReturnType<typeof runtime>>;

// Spy on requestRefresh so the test observes the selection decision without
// performing any upstream fetch. Returns the list of ids refreshStale chose.
function spyOnRequestRefresh(instance: Instance): { requested: string[] } {
  const requested: string[] = [];
  const manager = instance.quotaSnapshots as unknown as { requestRefresh: (id: string) => Promise<unknown> };
  manager.requestRefresh = async (id: string) => {
    requested.push(id);
    return null;
  };
  return { requested };
}

function upsertSnapshot(
  instance: Instance,
  connectionId: string,
  provider: string,
  overrides: Partial<{
    status: "error" | "pending" | "ready";
    nextRefreshAt: string | null;
    lastError: string | null;
  }> = {},
) {
  instance.repos.quotaSnapshots.upsert({
    connectionId,
    provider,
    payload: { quotas: { Monthly: { used: 1, total: 10 } } },
    status: overrides.status ?? "ready",
    fetchedAt: new Date().toISOString(),
    expiresAt: null,
    nextRefreshAt: overrides.nextRefreshAt === undefined
      ? new Date(Date.now() + 60_000).toISOString()
      : overrides.nextRefreshAt,
    lastError: overrides.lastError ?? null,
    failureCount: 0,
  });
}

function grokConnection(instance: Instance, name: string) {
  return instance.repos.providers.create({
    provider: "grok-cli", authType: "oauth", name, email: `${name}@example.com`,
    credentials: { accessToken: "tok" },
  });
}

describe("QuotaSnapshotManager.refreshStale", () => {
  test("refreshes a connection that has no snapshot yet", async () => {
    const instance = await runtime();
    try {
      const { requested } = spyOnRequestRefresh(instance);
      const conn = grokConnection(instance, "g1");
      await instance.quotaSnapshots.refreshStale([conn.id]);
      expect(requested).toEqual([conn.id]);
    } finally {
      instance.close();
    }
  });

  test("does not refresh a connection whose snapshot is still fresh", async () => {
    const instance = await runtime();
    try {
      const conn = grokConnection(instance, "g2");
      upsertSnapshot(instance, conn.id, "grok-cli", {
        nextRefreshAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const { requested } = spyOnRequestRefresh(instance);
      await instance.quotaSnapshots.refreshStale([conn.id]);
      expect(requested).toEqual([]);
    } finally {
      instance.close();
    }
  });

  test("refreshes a connection whose snapshot is past due", async () => {
    const instance = await runtime();
    try {
      const conn = grokConnection(instance, "g3");
      upsertSnapshot(instance, conn.id, "grok-cli", {
        nextRefreshAt: new Date(Date.now() - 5_000).toISOString(),
      });
      const { requested } = spyOnRequestRefresh(instance);
      await instance.quotaSnapshots.refreshStale([conn.id]);
      expect(requested).toEqual([conn.id]);
    } finally {
      instance.close();
    }
  });

  test("refreshes an errored snapshot even when its due time is in the future", async () => {
    const instance = await runtime();
    try {
      const conn = grokConnection(instance, "g4");
      upsertSnapshot(instance, conn.id, "grok-cli", {
        status: "error",
        lastError: "upstream 500",
        nextRefreshAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const { requested } = spyOnRequestRefresh(instance);
      await instance.quotaSnapshots.refreshStale([conn.id]);
      expect(requested).toEqual([conn.id]);
    } finally {
      instance.close();
    }
  });

  test("treats a snapshot with no due time as stale", async () => {
    const instance = await runtime();
    try {
      const conn = grokConnection(instance, "g5");
      upsertSnapshot(instance, conn.id, "grok-cli", { nextRefreshAt: null });
      const { requested } = spyOnRequestRefresh(instance);
      await instance.quotaSnapshots.refreshStale([conn.id]);
      expect(requested).toEqual([conn.id]);
    } finally {
      instance.close();
    }
  });

  test("skips inactive, ineligible, and unknown connections", async () => {
    const instance = await runtime();
    try {
      const inactive = grokConnection(instance, "g6");
      instance.repos.providers.update(inactive.id, { isActive: false });
      const ineligible = instance.repos.providers.create({
        provider: "grok-cli", authType: "apikey", name: "g7", email: null,
        credentials: { apiKey: "key" },
      });
      const { requested } = spyOnRequestRefresh(instance);
      await instance.quotaSnapshots.refreshStale([inactive.id, ineligible.id, "does-not-exist"]);
      expect(requested).toEqual([]);
    } finally {
      instance.close();
    }
  });

  test("processes a mixed list and refreshes only the stale ones", async () => {
    const instance = await runtime();
    try {
      const stale = grokConnection(instance, "g8");
      const fresh = grokConnection(instance, "g9");
      upsertSnapshot(instance, stale.id, "grok-cli", { nextRefreshAt: new Date(Date.now() - 1_000).toISOString() });
      upsertSnapshot(instance, fresh.id, "grok-cli", { nextRefreshAt: new Date(Date.now() + 60_000).toISOString() });
      const { requested } = spyOnRequestRefresh(instance);
      await instance.quotaSnapshots.refreshStale([stale.id, fresh.id]);
      expect(requested).toEqual([stale.id]);
    } finally {
      instance.close();
    }
  });
});
