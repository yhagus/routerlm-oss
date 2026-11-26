import { instantOfWallClock } from "./wall-clock";

export interface ValidityPeriod {
  validFrom: string | null;
  validUntil: string | null;
}

export interface ValidityInstants {
  start: Date | null;
  end: Date | null;
}

export function validityInstantsOf(period: ValidityPeriod, timeZone: string): ValidityInstants {
  return {
    start: period.validFrom === null ? null : instantOfWallClock(period.validFrom, timeZone),
    end: period.validUntil === null ? null : instantOfWallClock(period.validUntil, timeZone),
  };
}

export function isWithinValidityPeriod(
  period: ValidityPeriod,
  timeZone: string,
  instant: Date,
): boolean {
  const { start, end } = validityInstantsOf(period, timeZone);
  const hasStarted = start === null || instant >= start;
  const hasEnded = end !== null && instant >= end;
  return hasStarted && !hasEnded;
}

export function describeValidityPeriod(period: ValidityPeriod): string {
  const bounds = [];
  if (period.validFrom !== null) {
    bounds.push(`from ${readableWallClock(period.validFrom)}`);
  }
  if (period.validUntil !== null) {
    bounds.push(`until ${readableWallClock(period.validUntil)}`);
  }
  return bounds.join(" ");
}

function readableWallClock(wallClock: string): string {
  return wallClock.replace("T", " ");
}
