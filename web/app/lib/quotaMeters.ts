import type { QuotaMeter } from "~/lib/upstream";

/** At or below these remaining percents a Quota Meter turns yellow, then red. */
const LOW_REMAINING_PERCENT = 30;
const CRITICAL_REMAINING_PERCENT = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type QuotaMeterTone = "good" | "warn" | "bad";

/** The bar's color: yellow at 30% left or less, red at 10% or less. */
export function quotaMeterTone(meter: QuotaMeter): QuotaMeterTone {
  if (meter.isUnlimited || meter.remainingPercent === null) return "good";
  if (meter.remainingPercent <= CRITICAL_REMAINING_PERCENT) return "bad";
  if (meter.remainingPercent <= LOW_REMAINING_PERCENT) return "warn";
  return "good";
}

/** How much of the bar is filled, 0–100: full when unlimited, empty when the Provider gives no percent. */
export function quotaMeterFill(meter: QuotaMeter): number {
  if (meter.isUnlimited) return 100;
  return Math.min(100, Math.max(0, meter.remainingPercent ?? 0));
}

/** What is left, in words: "75%", "Unlimited", or "—" when the Provider gives no percent. */
export function quotaMeterRemaining(meter: QuotaMeter): string {
  if (meter.isUnlimited) return "Unlimited";
  if (meter.remainingPercent === null) return "—";
  return `${Math.round(meter.remainingPercent)}%`;
}

/** A span as its two largest units: "2d 4h", "1h 37m", "12m", or "under 1m". */
export function shortDuration(ms: number): string {
  if (ms < MINUTE_MS) return "under 1m";
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** "resets in 1h 37m" as of `now`; null when the reset time is unknown or already passed. */
export function resetCountdown(resetsAt: string | null, now: number): string | null {
  if (resetsAt === null) return null;
  const remainingMs = new Date(resetsAt).getTime() - now;
  return remainingMs > 0 ? `resets in ${shortDuration(remainingMs)}` : null;
}

/** "Checked 5m ago" as of `now`, or "Never checked". */
export function checkedAgo(quotaCheckedAt: string | null, now: number): string {
  if (quotaCheckedAt === null) return "Never checked";
  const elapsedMs = now - new Date(quotaCheckedAt).getTime();
  if (elapsedMs < MINUTE_MS) return "Checked just now";
  return `Checked ${shortDuration(elapsedMs)} ago`;
}
