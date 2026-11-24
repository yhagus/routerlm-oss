import type { QuotaMeterReading } from "./quota-meter.js";

export type ExhaustedState = { isExhausted: false } | { isExhausted: true; until: Date | null };

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
