import type { FakeReply } from './fake-upstream';

export const USAGE_PATH = '/backend-api/wham/usage';
export const RESET_CREDITS_PATH = '/backend-api/wham/rate-limit-reset-credits';
export const CONSUME_PATH = '/backend-api/wham/rate-limit-reset-credits/consume';

export const FIVE_HOURS_IN_SECONDS = 18_000;
export const WEEK_IN_SECONDS = 604_800;
const DAY_MS = 86_400_000;

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

export function usageReply(answer: {
  rateLimit: UsageRateLimit | null;
  additionalRateLimits?: Array<{ limit_name: string; rate_limit: UsageRateLimit | null }>;
  usageResetCount?: number;
}): FakeReply {
  return {
    kind: 'json',
    status: 200,
    body: {
      plan_type: 'pro',
      rate_limit: answer.rateLimit,
      credits: { has_credits: true, unlimited: false, balance: '42.5' },
      additional_rate_limits: (answer.additionalRateLimits ?? []).map((limit) => ({
        ...limit,
        metered_feature: limit.limit_name,
      })),
      ...(answer.usageResetCount === undefined
        ? {}
        : { rate_limit_reset_credits: { available_count: answer.usageResetCount } }),
    },
  };
}

export function usageAtPercentReply(
  usedPercent: number,
  resetsAt: Date,
  usageResetCount?: number,
): FakeReply {
  return usageReply({
    rateLimit: rateLimitOf({
      primary: usageWindow(usedPercent, FIVE_HOURS_IN_SECONDS, resetsAt),
      secondary: usageWindow(usedPercent, WEEK_IN_SECONDS, resetsAt),
    }),
    usageResetCount,
  });
}

export type ResetCreditStatus = 'available' | 'redeeming' | 'redeemed';

export interface ResetCredit {
  id: string;
  reset_type: string;
  status: ResetCreditStatus;
  granted_at: string;
  expires_at: string | null;
  title: string;
  description: string;
}

export function resetCredit(
  id: string,
  expiresAt: Date | null,
  status: ResetCreditStatus = 'available',
): ResetCredit {
  return {
    id,
    reset_type: 'all_windows',
    status,
    granted_at: new Date(Date.now() - DAY_MS).toISOString(),
    expires_at: expiresAt?.toISOString() ?? null,
    title: `Reset ${id}`,
    description: 'Restores your usage limits once',
  };
}

export function resetCreditsReply(credits: ResetCredit[]): FakeReply {
  const availableCount = credits.filter((credit) => credit.status === 'available').length;
  return {
    kind: 'json',
    status: 200,
    body: { credits, available_count: availableCount, total_earned_count: credits.length },
  };
}

export type ConsumeCode = 'reset' | 'nothing_to_reset' | 'no_credit' | 'already_redeemed';

export function consumeReply(code: ConsumeCode): FakeReply {
  return {
    kind: 'json',
    status: 200,
    body: { code, windows_reset: code === 'reset' ? 2 : 0 },
  };
}
