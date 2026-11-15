import type { QuotaMeterReading } from "./quota-meter.js";

/**
 * Whether a reading makes its Provider Account Exhausted (GLOSSARY), and
 * until when: the reset of the last of its run-out meters, or null when none
 * of them says when it resets.
 */
export type ExhaustedState = { isExhausted: false } | { isExhausted: true; until: Date | null };

/**
 * Only unscoped meters count: a scoped one such as `weekly:video` covers what
 * the gateway doesn't serve.
 */
export function exhaustedStateOf(meters: QuotaMeterReading[], now: Date): ExhaustedState {
  const runOut = meters.filter((meter) => isRunOut(meter, now));
  if (runOut.length === 0) {
    return { isExhausted: false };
  }
  const resets = runOut.flatMap((meter) =>
    meter.resetsAt === null ? [] : [meter.resetsAt.getTime()],
  );
  return {
    isExhausted: true,
    until: resets.length === 0 ? null : new Date(Math.max(...resets)),
  };
}

function isRunOut(meter: QuotaMeterReading, now: Date): boolean {
  if (meter.scope !== null || meter.isUnlimited || meter.remainingPercent === null) {
    return false;
  }
  const hasReset = meter.resetsAt !== null && meter.resetsAt <= now;
  return meter.remainingPercent <= 0 && !hasReset;
}
