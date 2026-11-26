import { parseDateTime, toCalendarDateTime, toTimeZone, toZoned } from '@internationalized/date';
import type { PricingWindowRange } from '~/lib/pricingWindows';

export interface ValidityPeriod {
  validFrom: string | null;
  validUntil: string | null;
}

export interface WindowPricesTiming extends ValidityPeriod {
  timeZone: string;
  ranges: readonly PricingWindowRange[];
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const WALL_CLOCK_LENGTH = 16;

export function hasOpenBound(period: ValidityPeriod): boolean {
  return period.validFrom === null || period.validUntil === null;
}

/**
 * "from 2026-12-01 00:00 until 2027-01-01 00:00", "from …", "until …" or "always".
 * Mirrors the backend's `describeValidityPeriod`, which words the API's refusals,
 * except that a period with no bounds reads "always" here and "" there.
 */
export function formatValidityPeriod(period: ValidityPeriod): string {
  const parts: string[] = [];
  if (period.validFrom !== null) parts.push(`from ${period.validFrom.replace('T', ' ')}`);
  if (period.validUntil !== null) parts.push(`until ${period.validUntil.replace('T', ' ')}`);
  return parts.length > 0 ? parts.join(' ') : 'always';
}

export function mayApplyTogether(first: WindowPricesTiming, second: WindowPricesTiming): boolean {
  if (!doValidityPeriodsIntersect(first, second)) return false;
  if (first.timeZone !== second.timeZone) return true;
  return doWeeklyHoursMeet(first.ranges, second.ranges);
}

export function periodsAround(open: WindowPricesTiming, cut: WindowPricesTiming): ValidityPeriod[] {
  const pieces: ValidityPeriod[] = [];
  if (cut.validFrom !== null) {
    const cutStart = wallClockIn(cut.validFrom, cut.timeZone, open.timeZone);
    if (open.validFrom === null || open.validFrom < cutStart) {
      pieces.push({ validFrom: open.validFrom, validUntil: cutStart });
    }
  }
  if (cut.validUntil !== null) {
    const cutEnd = wallClockIn(cut.validUntil, cut.timeZone, open.timeZone);
    if (open.validUntil === null || cutEnd < open.validUntil) {
      pieces.push({ validFrom: cutEnd, validUntil: open.validUntil });
    }
  }
  return pieces;
}

function doValidityPeriodsIntersect(
  first: WindowPricesTiming,
  second: WindowPricesTiming,
): boolean {
  const latestStart = Math.max(startInstantOf(first), startInstantOf(second));
  const earliestEnd = Math.min(endInstantOf(first), endInstantOf(second));
  return latestStart < earliestEnd;
}

function startInstantOf(timing: WindowPricesTiming): number {
  if (timing.validFrom === null) return Number.NEGATIVE_INFINITY;
  return instantOf(timing.validFrom, timing.timeZone);
}

function endInstantOf(timing: WindowPricesTiming): number {
  if (timing.validUntil === null) return Number.POSITIVE_INFINITY;
  return instantOf(timing.validUntil, timing.timeZone);
}

function instantOf(wallClock: string, timeZone: string): number {
  return toZoned(parseDateTime(wallClock), timeZone).toDate().getTime();
}

function wallClockIn(wallClock: string, fromZone: string, toZone: string): string {
  if (fromZone === toZone) return wallClock;
  const zoned = toTimeZone(toZoned(parseDateTime(wallClock), fromZone), toZone);
  return toCalendarDateTime(zoned).toString().slice(0, WALL_CLOCK_LENGTH);
}

function doWeeklyHoursMeet(
  first: readonly PricingWindowRange[],
  second: readonly PricingWindowRange[],
): boolean {
  const secondSpans = second.flatMap(weekSpansOf);
  return first
    .flatMap(weekSpansOf)
    .some(([start, end]) =>
      secondSpans.some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end),
    );
}

function weekSpansOf(range: PricingWindowRange): [number, number][] {
  const start = minutesOf(range.start);
  const rawEnd = minutesOf(range.end);
  const end = rawEnd <= start ? rawEnd + MINUTES_PER_DAY : rawEnd;
  return range.weekdays.flatMap((weekday): [number, number][] => {
    const dayStart = (weekday - 1) * MINUTES_PER_DAY;
    const spanEnd = dayStart + end;
    if (spanEnd <= MINUTES_PER_WEEK) return [[dayStart + start, spanEnd]];
    return [
      [dayStart + start, MINUTES_PER_WEEK],
      [0, spanEnd - MINUTES_PER_WEEK],
    ];
  });
}

function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}
