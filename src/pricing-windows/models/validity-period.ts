import { instantOfWallClock } from "./wall-clock.js";

/**
 * When one Upstream Model's Window Prices can apply (ADR 0040): each bound a
 * `YYYY-MM-DDTHH:MM` on the wall clock of the window's time zone, the start
 * inclusive and the end exclusive. A null bound is open-ended.
 */
export interface ValidityPeriod {
  validFrom: string | null;
  validUntil: string | null;
}

/** A Validity Period as instants; a null bound is open-ended. */
export interface ValidityInstants {
  start: Date | null;
  end: Date | null;
}

/** The period's bounds as instants, read on the wall clock of `timeZone`. */
export function validityInstantsOf(period: ValidityPeriod, timeZone: string): ValidityInstants {
  return {
    start: period.validFrom === null ? null : instantOfWallClock(period.validFrom, timeZone),
    end: period.validUntil === null ? null : instantOfWallClock(period.validUntil, timeZone),
  };
}

/** Whether `instant` lies in the period, read on the wall clock of `timeZone`. */
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

/** "from 2026-12-01 00:00 until 2027-01-01 00:00", or "" for no period, for refusals. */
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
