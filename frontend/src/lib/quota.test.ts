import { afterEach, describe, expect, test, vi } from "vitest";
import { formatBalance, formatResetTime, getRemainingPercentage, parseQuotaData } from "./quota";

afterEach(() => vi.useRealTimers());

describe("Qoder quota tracker", () => {
  test("removes the Event prefix from activity names", () => {
    const quotas = parseQuotaData("qoder", {
      quotas: {
        "event:daily_activity": {
          displayName: "Event: Daily activity",
          activityId: "daily_activity",
          used: 1,
          total: 5,
        },
      },
    });

    expect(quotas[0]?.name).toBe("Daily activity");
  });

  test("formats countdowns as zero-padded days, hours, and minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"));

    expect(formatResetTime("2026-08-24T01:59:00.000Z")).toBe("05:01:59");
  });
});

describe("formatBalance", () => {
  test("shows the full number with thousands separators", () => {
    const values = [
      0,
      9999,
      10000,
      31181,
      99999,
      100000,
      1000000,
      1500000,
      1000000000,
    ];
    for (const value of values) {
      expect(formatBalance(value)).toBe(value.toLocaleString());
    }
  });
});

describe("Grok CLI quota tracker", () => {
  test("exposes per-family token bars with credit balances", () => {
    const quotas = parseQuotaData("grok-cli", {
      quotas: {
        "Grok 4.6": {
          used: 64079,
          total: 1000000,
          remainingPercentage: 93.5921,
          resetAt: "2026-10-02T12:00:00.000Z",
        },
        "Grok 4.7": {
          used: 200000,
          total: 1000000,
          remainingPercentage: 80,
          resetAt: null,
        },
        "Weekly SuperGrok": {
          used: 35,
          total: 100,
          remainingPercentage: 65,
          resetAt: null,
        },
        "Daily Allowance": {
          used: 250000,
          total: 1000000,
          remainingPercentage: 75,
          resetAt: null,
        },
      },
    });

    expect(quotas[0]).toEqual(
      expect.objectContaining({
        name: "Grok 4.6",
        used: 64079,
        total: 1000000,
        creditBalance: 935921,
        unit: "tokens",
        remainingPercentage: 93.5921,
      }),
    );
    expect(quotas[1]).toEqual(
      expect.objectContaining({
        name: "Grok 4.7",
        used: 200000,
        total: 1000000,
        creditBalance: 800000,
        unit: "tokens",
      }),
    );
    expect(getRemainingPercentage(quotas[0]!)).toBe(94);
    expect(quotas[2]?.creditBalance).toBeUndefined();
    expect(quotas[2]?.unit).toBeUndefined();
    expect(quotas[3]).toEqual(
      expect.objectContaining({
        name: "Daily Allowance",
        used: 250000,
        total: 1000000,
        creditBalance: 750000,
        unit: "tokens",
      }),
    );
  });
});

describe("CodeBuddy quota tracker", () => {
  test("preserves the credit balance alongside the percentage inputs", () => {
    const quotas = parseQuotaData("codebuddy-cn", {
      quotas: { Monthly: { used: 144.14, total: 250, resetAt: "2026-10-01T00:00:00.000Z" } },
    });

    expect(quotas).toEqual([expect.objectContaining({ name: "Monthly", unit: "credits" })]);
    expect(getRemainingPercentage(quotas[0]!)).toBe(42);
    expect(quotas[0]?.creditBalance).toBeCloseTo(105.86, 2);
  });
});

describe("AutoClaw quota tracker", () => {
  test("maps wallet balances to balance rows", () => {
    const quotas = parseQuotaData("autoclaw", {
      quotas: {
        reward: { name: "Reward", balance: 31181, unit: "points", resetAt: null },
        daily: { name: "Daily", balance: 0, unit: "points", resetAt: null },
      },
    });

    expect(quotas).toEqual([
      {
        name: "Reward",
        modelKey: "reward",
        used: 0,
        total: 0,
        unit: "points",
        balance: 31181,
        resetAt: null,
      },
      {
        name: "Daily",
        modelKey: "daily",
        used: 0,
        total: 0,
        unit: "points",
        balance: 0,
        resetAt: null,
      },
    ]);
  });
});
