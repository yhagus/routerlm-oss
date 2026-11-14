// Cooldown (GLOSSARY): how long a Provider Account that just failed is
// skipped. It starts short so one blip costs little, doubles while the
// failures continue, and honors the upstream's Retry-After.

const FIRST_COOLDOWN_MS = 5_000;
const LONGEST_COOLDOWN_MS = 5 * 60_000;
// A Retry-After beyond this is more likely a misconfigured upstream than a real wait.
const LONGEST_RETRY_AFTER_MS = 60 * 60_000;
const MS_PER_SECOND = 1000;

/**
 * How long to cool a Provider Account down after its `failureStreak`-th
 * failure in a row (1 for the first). A Retry-After longer than the grown
 * Cooldown wins; a shorter one does not shorten it.
 */
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

/** A Retry-After header (delay in seconds, or an HTTP date) in milliseconds; null if unreadable. */
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
