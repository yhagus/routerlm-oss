import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";
import {
  computeProviderQuotaSummary,
  extractQuotaRows,
  weightedRemaining,
} from "../src/services/billing/quotaSummary";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-quota-summary-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function readySnapshot(payload: Record<string, unknown>, fetchedAt = "2026-09-24T10:00:00.000Z") {
  return { payload, status: "ready" as const, fetchedAt };
}

describe("quotaSummary helpers", () => {
  test("extractQuotaRows reads provider-specific payload shapes", () => {
    expect(extractQuotaRows("claude", { quotas: { "session (5h)": { used: 25, total: 100 } } }))
      .toEqual([{ name: "session (5h)", used: 25, total: 100 }]);
    expect(extractQuotaRows("codex", { quotas: { daily: { used: 10, total: 50, remaining: 80 } } }))
      .toEqual([{ name: "daily", used: 10, total: 50, remaining: 80 }]);
    expect(extractQuotaRows("codebuddy-intl-cli", { quotas: { credits: { used: 30, total: 100 } } }))
      .toEqual([{ name: "credits", used: 30, total: 100, creditBalance: 70, remainingPercentage: 70, unit: "credits" }]);
    expect(extractQuotaRows("grok-cli", {
      quotas: {
        "Grok 4.6": { used: 64079, total: 1000000, remainingPercentage: 93.5921 },
        "Weekly SuperGrok": { used: 35, total: 100, remainingPercentage: 65 },
        "Daily Allowance": { used: 200000, total: 1000000, remainingPercentage: 80 },
      },
    })).toEqual([
      {
        name: "Grok 4.6",
        used: 64079,
        total: 1000000,
        remainingPercentage: 93.5921,
        creditBalance: 935921,
        unit: "tokens",
      },
      {
        name: "Weekly SuperGrok",
        used: 35,
        total: 100,
        remainingPercentage: 65,
      },
      {
        name: "Daily Allowance",
        used: 200000,
        total: 1000000,
        remainingPercentage: 80,
        creditBalance: 800000,
        unit: "tokens",
      },
    ]);
    expect(extractQuotaRows("autoclaw", { quotas: { wallet: { balance: 4200, unit: "points" } } }))
      .toEqual([{ name: "wallet", modelKey: "wallet", used: 0, total: 0, balance: 4200, unit: "points" }]);
    expect(extractQuotaRows("qoder", {
      quotas: {
        user: { used: 25, total: 100, unit: "credits" },
        organization: { used: 0, total: 0, unit: "credits" },
      },
    })).toEqual([{ name: "Personal", modelKey: "user", used: 25, total: 100, unit: "credits" }]);
    expect(extractQuotaRows("claude", { message: "OAuth token expired" })).toEqual([]);
    expect(extractQuotaRows("claude", null)).toEqual([]);
  });

  test("weightedRemaining weights by total and falls back to a simple mean", () => {
    expect(weightedRemaining([
      { name: "a", used: 20, total: 100 },
      { name: "b", used: 90, total: 200 },
    ])).toBe(63);
    expect(weightedRemaining([
      { name: "a", used: 0, total: 0, remainingPercentage: 60 },
      { name: "b", used: 0, total: 0, remainingPercentage: 80 },
    ])).toBe(70);
    expect(weightedRemaining([])).toBe(0);
  });

  test("computeProviderQuotaSummary sums balances for balance-kind providers", () => {
    const summary = computeProviderQuotaSummary("codebuddy-intl-cli", 2, [
      readySnapshot({ quotas: { credits: { used: 10, total: 100 } } }),
      readySnapshot({ quotas: { credits: { used: 5, total: 50 } } }),
    ], 2, 0);
    expect(summary.kind).toBe("percentage");
    expect(summary.totalCreditBalance).toBe(135);
    expect(summary.connectionsWithData).toBe(2);
    expect(summary.connectionsTotal).toBe(2);
    expect(summary.activeConnectionCount).toBe(2);
    expect(summary.inactiveConnectionCount).toBe(0);
  });

  test("computeProviderQuotaSummary reports the wallet balance for balance-kind providers", () => {
    const summary = computeProviderQuotaSummary("autoclaw", 2, [
      readySnapshot({ quotas: { wallet: { balance: 1000, unit: "points" } } }),
      readySnapshot({ quotas: { wallet: { balance: 250, unit: "points" } } }),
    ], 2, 0);
    expect(summary.kind).toBe("balance");
    expect(summary.totalBalance).toBe(1250);
    expect(summary.unit).toBe("points");
  });

  test("computeProviderQuotaSummary weights percentages across connections", () => {
    const summary = computeProviderQuotaSummary("claude", 2, [
      readySnapshot({ quotas: { "session (5h)": { used: 20, total: 100 } } }),
      readySnapshot({ quotas: { "session (5h)": { used: 90, total: 200 } } }),
    ], 2, 0);
    expect(summary.kind).toBe("percentage");
    expect(summary.remainingPercent).toBe(63);
  });

  test("computeProviderQuotaSummary skips error and empty snapshots but keeps them in the total", () => {
    const summary = computeProviderQuotaSummary("claude", 3, [
      readySnapshot({ quotas: { "session (5h)": { used: 0, total: 100 } } }),
      { payload: { message: "OAuth token expired" }, status: "error" as const, fetchedAt: null },
      { payload: {}, status: "pending" as const, fetchedAt: null },
    ], 3, 1);
    expect(summary.connectionsWithData).toBe(1);
    expect(summary.connectionsTotal).toBe(3);
    expect(summary.remainingPercent).toBe(100);
    expect(summary.activeConnectionCount).toBe(3);
    expect(summary.inactiveConnectionCount).toBe(1);
  });

  test("computeProviderQuotaSummary returns an empty summary when nothing has data", () => {
    const summary = computeProviderQuotaSummary("claude", 0, [], 0, 0);
    expect(summary).toEqual({
      kind: null,
      totalBalance: null,
      unit: null,
      remainingPercent: null,
      totalCreditBalance: 0,
      quotaMeters: [],
      connectionsWithData: 0,
      connectionsTotal: 0,
      activeConnectionCount: 0,
      inactiveConnectionCount: 0,
      totalConnectionCount: 0,
      lastFetchedAt: null,
    });
  });

  test("computeProviderQuotaSummary sums grok-cli family token remaining as credits", () => {
    const summary = computeProviderQuotaSummary("grok-cli", 2, [
      readySnapshot({
        quotas: {
          "Grok 4.6": { used: 64079, total: 1000000, remainingPercentage: 93.5921 },
          "Grok 4.7": { used: 200000, total: 1000000, remainingPercentage: 80 },
        },
      }),
      readySnapshot({
        quotas: {
          "Grok 4.6": { used: 100000, total: 1000000, remainingPercentage: 90 },
          "Weekly SuperGrok": { used: 35, total: 100, remainingPercentage: 65 },
        },
      }),
    ], 2, 0);
    expect(summary.kind).toBe("percentage");
    expect(summary.totalCreditBalance).toBe(2635921);
    const grok46 = summary.quotaMeters.find((m) => m.key === "Grok 4.6");
    const weekly = summary.quotaMeters.find((m) => m.key === "Weekly SuperGrok");
    expect(grok46?.creditBalance).toBe(1835921);
    expect(weekly?.creditBalance).toBeNull();
  });

  test("computeProviderQuotaSummary computes per-meter breakdown", () => {
    const summary = computeProviderQuotaSummary("codebuddy-intl-cli", 2, [
      readySnapshot({ quotas: { Monthly: { used: 10, total: 100 }, Daily: { used: 5, total: 20 } } }),
      readySnapshot({ quotas: { Monthly: { used: 20, total: 100 }, Daily: { used: 10, total: 20 } } }),
    ], 2, 1);
    expect(summary.quotaMeters).toHaveLength(2);
    const monthly = summary.quotaMeters.find((m) => m.key === "Monthly");
    const daily = summary.quotaMeters.find((m) => m.key === "Daily");
    expect(monthly).toBeDefined();
    expect(daily).toBeDefined();
    expect(monthly?.creditBalance).toBe(170);
    expect(daily?.creditBalance).toBe(25);
  });
});

describe("GET /api/providers/:id/quota-summary", () => {
  test("aggregates stored snapshots for every active connection without any upstream fetch", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const first = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "t1" } });
      const second = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "t2" } });
      const inactive = instance.repos.providers.create({ provider: "claude", authType: "oauth", credentials: { accessToken: "t3" }, isActive: false });
      const other = instance.repos.providers.create({ provider: "codex", authType: "oauth", credentials: { accessToken: "t4" } });

      instance.repos.quotaSnapshots.upsert({
        connectionId: first.id,
        provider: "claude",
        payload: { quotas: { "session (5h)": { used: 20, total: 100 } } },
        status: "ready",
        fetchedAt: "2026-09-24T10:00:00.000Z",
        expiresAt: null,
        nextRefreshAt: null,
        lastError: null,
        failureCount: 0,
      });
      instance.repos.quotaSnapshots.upsert({
        connectionId: second.id,
        provider: "claude",
        payload: { quotas: { "session (5h)": { used: 90, total: 200 } } },
        status: "ready",
        fetchedAt: "2026-09-24T10:00:30.000Z",
        expiresAt: null,
        nextRefreshAt: null,
        lastError: null,
        failureCount: 0,
      });
      instance.repos.quotaSnapshots.upsert({
        connectionId: inactive.id,
        provider: "claude",
        payload: { quotas: { "session (5h)": { used: 0, total: 100 } } },
        status: "ready",
        fetchedAt: "2026-09-24T10:01:00.000Z",
        expiresAt: null,
        nextRefreshAt: null,
        lastError: null,
        failureCount: 0,
      });
      instance.repos.quotaSnapshots.upsert({
        connectionId: other.id,
        provider: "codex",
        payload: { quotas: { daily: { used: 1, total: 10 } } },
        status: "ready",
        fetchedAt: "2026-09-24T10:02:00.000Z",
        expiresAt: null,
        nextRefreshAt: null,
        lastError: null,
        failureCount: 0,
      });

      let upstreamCalls = 0;
      installFetchMock(async () => {
        upstreamCalls += 1;
        return Response.json({});
      });

      const app = createApp(instance);
      const response = await app.request("/api/providers/claude/quota-summary");
      expect(response.status).toBe(200);
      const summary = await response.json();
      // Only the two ACTIVE claude connections count; the inactive row and the
      // codex row must not leak into the aggregate.
      expect(summary).toMatchObject({
        kind: "percentage",
        remainingPercent: 63,
        connectionsWithData: 2,
        connectionsTotal: 2,
        lastFetchedAt: "2026-09-24T10:00:30.000Z",
      });
      // Read-only: the endpoint must never hit the upstream quota API.
      expect(upstreamCalls).toBe(0);
    } finally {
      installFetchMock(null);
      instance.close();
    }
  });

  test("returns 200 with an empty summary for a provider without connections", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const app = createApp(instance);
      const response = await app.request("/api/providers/claude/quota-summary");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        kind: null,
        connectionsTotal: 0,
        connectionsWithData: 0,
      });
    } finally {
      instance.close();
    }
  });

  test("resolves provider aliases before aggregating", async () => {
    const instance = await runtime();
    installFetchMock(null);
    try {
      const connection = instance.repos.providers.create({ provider: "codebuddy-intl-cli", authType: "oauth", credentials: { accessToken: "t1" } });
      instance.repos.quotaSnapshots.upsert({
        connectionId: connection.id,
        provider: "codebuddy-intl-cli",
        payload: { quotas: { credits: { used: 30, total: 100 } } },
        status: "ready",
        fetchedAt: "2026-09-24T10:00:00.000Z",
        expiresAt: null,
        nextRefreshAt: null,
        lastError: null,
        failureCount: 0,
      });
      const app = createApp(instance);
      const response = await app.request("/api/providers/codebuddy-intl-cli/quota-summary");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        kind: "percentage",
        remainingPercent: 70,
        totalCreditBalance: 70,
        connectionsWithData: 1,
        connectionsTotal: 1,
      });
    } finally {
      instance.close();
    }
  });
});
