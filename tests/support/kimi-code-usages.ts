import type { FakeReply } from "./fake-upstream.js";

/** Where the Kimi Code quota reader asks, relative to the fake upstream's origin. */
export const USAGES_PATH = "/v1/usages";

/** One limit of a Kimi `/usages` answer; `used_ratio` runs from 0 to 1. */
export interface UsagesLimit {
  used_ratio: number | string;
  reset_time: string;
}

/** The limits a plan may report; a plan reports only some of them. */
export interface Usages {
  limit_5h?: UsagesLimit;
  limit_7d?: UsagesLimit;
  limit_month_total?: UsagesLimit;
  limit_month_code?: UsagesLimit;
}

/** All four limits, part used, in the shape a live `GET /usages` answered with an API key. */
export const ALL_LIMITS = {
  limit_5h: { used_ratio: 0.25, reset_time: "2026-11-15T16:00:00Z" },
  limit_7d: { used_ratio: 0.5, reset_time: "2026-11-20T00:00:00Z" },
  limit_month_total: { used_ratio: 0.125, reset_time: "2026-12-01T00:00:00+08:00" },
  limit_month_code: { used_ratio: 0.75, reset_time: "2026-12-01T00:00:00+08:00" },
} satisfies Usages;

/**
 * A successful `/usages` answer reporting `usages`, with the `limits` array
 * and `boosterWallet` Kimi sends beside them. Those say the plan is used up
 * and unlimited, which no meter may show: the reader ignores both.
 */
export function usagesReply(usages: Usages = ALL_LIMITS): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      usages,
      limits: [
        { window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { used_ratio: 1 } },
      ],
      boosterWallet: { balance: "12.5", unlimited: true },
    },
  };
}

/** A `/usages` answer for the account with every limit used up to `usedRatio`, resetting at `resetsAt`. */
export function usagesAtRatioReply(usedRatio: number, resetsAt: Date): FakeReply {
  const limit = { used_ratio: usedRatio, reset_time: resetsAt.toISOString() };
  return usagesReply({
    limit_5h: limit,
    limit_7d: limit,
    limit_month_total: limit,
    limit_month_code: limit,
  });
}
