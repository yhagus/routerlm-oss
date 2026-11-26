import { dateFormat } from '~/lib/dateFormats';
import type { QuotaMeter } from '~/lib/upstream';

const LOW_REMAINING_PERCENT = 30;
const CRITICAL_REMAINING_PERCENT = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type QuotaMeterTone = 'good' | 'warn' | 'bad';

export function quotaMeterTone(meter: QuotaMeter): QuotaMeterTone {
  if (meter.isUnlimited || meter.remainingPercent === null) return 'good';
  if (meter.remainingPercent <= CRITICAL_REMAINING_PERCENT) return 'bad';
  if (meter.remainingPercent <= LOW_REMAINING_PERCENT) return 'warn';
  return 'good';
}

export function quotaMeterFill(meter: QuotaMeter): number {
  if (meter.isUnlimited) return 100;
  return Math.min(100, Math.max(0, meter.remainingPercent ?? 0));
}

export function quotaMeterRemaining(meter: QuotaMeter): string {
  if (meter.isUnlimited) return 'Unlimited';
  if (meter.remainingPercent === null) return '—';
  return `${Math.round(meter.remainingPercent)}%`;
}

export function shortDuration(ms: number): string {
  if (ms < MINUTE_MS) return 'under 1m';
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function resetCountdown(resetsAt: string | null, now: number): string | null {
  if (resetsAt === null) return null;
  const remainingMs = new Date(resetsAt).getTime() - now;
  return remainingMs > 0 ? `resets in ${shortDuration(remainingMs)}` : null;
}

const EXPIRY_AS_DAYS_LIMIT_MS = 30 * DAY_MS;

export function usageResetCount(count: number): string {
  if (count === 0) return 'No usage resets';
  return count === 1 ? '1 usage reset' : `${count} usage resets`;
}

export function usageResetExpiry(expiresAt: string | null, now: number): string {
  if (expiresAt === null) return 'never expires';
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (remainingMs <= 0) return `expired ${dateFormat.format(new Date(expiresAt))}`;
  if (remainingMs < DAY_MS) return `expires in ${shortDuration(remainingMs)}`;
  if (remainingMs >= EXPIRY_AS_DAYS_LIMIT_MS)
    return `expires ${dateFormat.format(new Date(expiresAt))}`;
  const days = Math.floor(remainingMs / DAY_MS);
  return days === 1 ? 'expires in 1 day' : `expires in ${days} days`;
}

export function checkedAgo(quotaCheckedAt: string | null, now: number): string {
  if (quotaCheckedAt === null) return 'Never checked';
  const elapsedMs = now - new Date(quotaCheckedAt).getTime();
  if (elapsedMs < MINUTE_MS) return 'Checked just now';
  return `Checked ${shortDuration(elapsedMs)} ago`;
}
