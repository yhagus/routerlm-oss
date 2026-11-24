const FIRST_COOLDOWN_MS = 5_000;
const LONGEST_COOLDOWN_MS = 5 * 60_000;
const LONGEST_RETRY_AFTER_MS = 60 * 60_000;
const MS_PER_SECOND = 1000;

export function cooldownDurationMs(
  failureStreak: number,
  retryAfter: string | null,
  now: Date,
): number {
  const grown = Math.min(FIRST_COOLDOWN_MS * 2 ** (failureStreak - 1), LONGEST_COOLDOWN_MS);
  const requested = retryAfter === null ? null : retryAfterMs(retryAfter, now);
  if (requested === null) {
    return grown;
  }
  return Math.max(grown, Math.min(requested, LONGEST_RETRY_AFTER_MS));
}

function retryAfterMs(retryAfter: string, now: Date): number | null {
  const trimmed = retryAfter.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * MS_PER_SECOND;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(date - now.getTime(), 0);
}
