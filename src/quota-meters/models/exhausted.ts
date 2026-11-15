import type { QuotaMeterReading } from "./quota-meter.js";

// A meter that ran out without saying when it resets is read again within
// this long by the reading schedule, which then sets the precise end.
const EXHAUSTED_WITHOUT_RESET_MS = 60_000;

/**
 * Until when a reading makes its Provider Account Exhausted (GLOSSARY), or
 * null when it still has quota. Only unscoped meters count: a scoped one such
 * as `weekly:video` covers what the gateway doesn't serve. The account stays
 * Exhausted until the last of its run-out meters resets.
 */
export function exhaustedUntil(meters: QuotaMeterReading[], now: Date): Date | null {
  const resets = meters
    .filter((meter) => isRunOut(meter, now))
    .map((meter) => meter.resetsAt ?? new Date(now.getTime() + EXHAUSTED_WITHOUT_RESET_MS));
  if (resets.length === 0) {
    return null;
  }
  return new Date(Math.max(...resets.map((resetsAt) => resetsAt.getTime())));
}

function isRunOut(meter: QuotaMeterReading, now: Date): boolean {
  if (meter.scope !== null || meter.isUnlimited || meter.remainingPercent === null) {
    return false;
  }
  const hasReset = meter.resetsAt !== null && meter.resetsAt <= now;
  return meter.remainingPercent <= 0 && !hasReset;
}
