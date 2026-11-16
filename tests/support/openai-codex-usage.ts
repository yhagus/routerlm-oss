import type { FakeReply } from "./fake-upstream.js";

/** Where the OpenAI Codex quota reader asks, on the Provider's origin. */
export const USAGE_PATH = "/backend-api/wham/usage";

export const FIVE_HOURS_IN_SECONDS = 18_000;
export const WEEK_IN_SECONDS = 604_800;

/** One window of a `wham/usage` answer; `reset_at` is in epoch seconds. */
export interface UsageWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_after_seconds: number;
  reset_at: number;
}

export interface UsageRateLimit {
  allowed: boolean;
  limit_reached: boolean;
  primary_window: UsageWindow | null;
  secondary_window: UsageWindow | null;
}

/** A window of `windowSeconds` used up to `usedPercent`, resetting at `resetsAt`. */
export function usageWindow(
  usedPercent: number,
  windowSeconds: number,
  resetsAt: Date,
): UsageWindow {
  const resetAtSeconds = Math.floor(resetsAt.getTime() / 1000);
  return {
    used_percent: usedPercent,
    limit_window_seconds: windowSeconds,
    reset_after_seconds: Math.max(0, resetAtSeconds - Math.floor(Date.now() / 1000)),
    reset_at: resetAtSeconds,
  };
}

export function rateLimitOf(windows: {
  primary?: UsageWindow;
  secondary?: UsageWindow;
}): UsageRateLimit {
  return {
    allowed: true,
    limit_reached: false,
    primary_window: windows.primary ?? null,
    secondary_window: windows.secondary ?? null,
  };
}

/** A successful `wham/usage` answer, in the shape the Codex CLI's backend client reads. */
export function usageReply(answer: {
  rateLimit: UsageRateLimit | null;
  additionalRateLimits?: Array<{ limit_name: string; rate_limit: UsageRateLimit | null }>;
}): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      plan_type: "pro",
      rate_limit: answer.rateLimit,
      credits: { has_credits: true, unlimited: false, balance: "42.5" },
      additional_rate_limits: (answer.additionalRateLimits ?? []).map((limit) => ({
        ...limit,
        metered_feature: limit.limit_name,
      })),
    },
  };
}

/** A `wham/usage` answer with both windows used up to `usedPercent`, resetting at `resetsAt`. */
export function usageAtPercentReply(usedPercent: number, resetsAt: Date): FakeReply {
  return usageReply({
    rateLimit: rateLimitOf({
      primary: usageWindow(usedPercent, FIVE_HOURS_IN_SECONDS, resetsAt),
      secondary: usageWindow(usedPercent, WEEK_IN_SECONDS, resetsAt),
    }),
  });
}
