import type { PricingWindowRange } from "@/db/schemas/index.js";
import { type ValidityPeriod, validityInstantsOf } from "./validity-period.js";
import {
  MILLISECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  minuteOfDayOf,
  utcOffsetMinutesAt,
} from "./wall-clock.js";

export interface WindowPricesTiming extends ValidityPeriod {
  timeZone: string;
  ranges: PricingWindowRange[];
}

interface InstantSpan {
  start: Date;
  end: Date;
}

interface WeekInterval {
  start: number;
  end: number;
}

const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MILLISECONDS_PER_DAY = MINUTES_PER_DAY * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_COMPARISON = 366 * MILLISECONDS_PER_DAY;
const FIRST_MONDAY_IN_MINUTES = 4 * MINUTES_PER_DAY;

export function doWindowPricesOverlap(
  first: WindowPricesTiming,
  second: WindowPricesTiming,
  now: Date,
): boolean {
  const firstPeriod = validityInstantsOf(first, first.timeZone);
  const secondPeriod = validityInstantsOf(second, second.timeZone);
  const sharedStart = laterOf(firstPeriod.start, secondPeriod.start);
  const sharedEnd = earlierOf(firstPeriod.end, secondPeriod.end);
  if (sharedStart !== null && sharedEnd !== null && sharedStart >= sharedEnd) {
    return false;
  }
  return doSchedulesShareAMoment(first, second, comparisonSpanOf(sharedStart, sharedEnd, now));
}

export function findOverlappingWindowPrices<Attachment extends WindowPricesTiming>(
  attachments: readonly Attachment[],
  now: Date,
): [Attachment, Attachment] | undefined {
  for (const [index, later] of attachments.entries()) {
    const earlier = attachments
      .slice(0, index)
      .find((attachment) => doWindowPricesOverlap(attachment, later, now));
    if (earlier !== undefined) {
      return [earlier, later];
    }
  }
  return undefined;
}

function comparisonSpanOf(
  sharedStart: Date | null,
  sharedEnd: Date | null,
  now: Date,
): InstantSpan {
  if (
    sharedStart !== null &&
    sharedEnd !== null &&
    sharedEnd.getTime() - sharedStart.getTime() <= MILLISECONDS_PER_COMPARISON
  ) {
    return { start: sharedStart, end: sharedEnd };
  }
  const from = laterOf(sharedStart, now) ?? now;
  if (sharedEnd !== null && from.getTime() + MILLISECONDS_PER_COMPARISON > sharedEnd.getTime()) {
    return {
      start: new Date(sharedEnd.getTime() - MILLISECONDS_PER_COMPARISON),
      end: sharedEnd,
    };
  }
  return { start: from, end: new Date(from.getTime() + MILLISECONDS_PER_COMPARISON) };
}

function laterOf(first: Date | null, second: Date | null): Date | null {
  if (first === null || second === null) {
    return first ?? second;
  }
  return first > second ? first : second;
}

function earlierOf(first: Date | null, second: Date | null): Date | null {
  if (first === null || second === null) {
    return first ?? second;
  }
  return first < second ? first : second;
}

function doSchedulesShareAMoment(
  first: WindowPricesTiming,
  second: WindowPricesTiming,
  span: InstantSpan,
): boolean {
  return spansOfSteadyOffsets(first.timeZone, second.timeZone, span).some((steadySpan) => {
    const firstIntervals = utcWeekIntervalsOf(
      first.ranges,
      utcOffsetMinutesAt(first.timeZone, steadySpan.start),
    );
    const secondIntervals = utcWeekIntervalsOf(
      second.ranges,
      utcOffsetMinutesAt(second.timeZone, steadySpan.start),
    );
    return firstIntervals.some((interval) =>
      secondIntervals.some((other) => doWeekIntervalsMeetDuring(interval, other, steadySpan)),
    );
  });
}

function spansOfSteadyOffsets(
  firstTimeZone: string,
  secondTimeZone: string,
  span: InstantSpan,
): InstantSpan[] {
  const cuts = [
    ...offsetChangesDuring(firstTimeZone, span),
    ...offsetChangesDuring(secondTimeZone, span),
  ].sort((earlier, later) => earlier.getTime() - later.getTime());
  const boundaries = [span.start, ...cuts, span.end];
  return boundaries
    .slice(1)
    .map((end, index) => ({ start: boundaries[index], end }))
    .filter((piece) => piece.start < piece.end);
}

function offsetChangesDuring(timeZone: string, span: InstantSpan): Date[] {
  const changes: Date[] = [];
  let before = span.start.getTime();
  while (before < span.end.getTime()) {
    const after = Math.min(before + MILLISECONDS_PER_DAY, span.end.getTime());
    if (
      utcOffsetMinutesAt(timeZone, new Date(before)) !==
      utcOffsetMinutesAt(timeZone, new Date(after))
    ) {
      changes.push(firstInstantWithOffsetOf(timeZone, before, after));
    }
    before = after;
  }
  return changes;
}

function firstInstantWithOffsetOf(timeZone: string, before: number, after: number): Date {
  const offsetAfter = utcOffsetMinutesAt(timeZone, new Date(after));
  let low = before;
  let high = after;
  while (high - low > MILLISECONDS_PER_MINUTE) {
    const middle = low + Math.floor((high - low) / 2);
    if (utcOffsetMinutesAt(timeZone, new Date(middle)) === offsetAfter) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return new Date(high);
}

function utcWeekIntervalsOf(ranges: PricingWindowRange[], offsetMinutes: number): WeekInterval[] {
  return ranges.flatMap((range) => {
    const startMinute = minuteOfDayOf(range.start);
    const endMinute = minuteOfDayOf(range.end);
    const length =
      startMinute < endMinute ? endMinute - startMinute : MINUTES_PER_DAY - startMinute + endMinute;
    return range.weekdays.map((weekday) => {
      const localStart = (weekday - 1) * MINUTES_PER_DAY + startMinute;
      const start = positiveModulo(localStart - offsetMinutes, MINUTES_PER_WEEK);
      return { start, end: start + length };
    });
  });
}

function doWeekIntervalsMeetDuring(
  first: WeekInterval,
  second: WeekInterval,
  span: InstantSpan,
): boolean {
  return [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK].some((shift) => {
    const shared: WeekInterval = {
      start: Math.max(first.start, second.start + shift),
      end: Math.min(first.end, second.end + shift),
    };
    return shared.start < shared.end && doesWeekIntervalRecurDuring(shared, span);
  });
}

function doesWeekIntervalRecurDuring(interval: WeekInterval, span: InstantSpan): boolean {
  const spanMinutes = (span.end.getTime() - span.start.getTime()) / MILLISECONDS_PER_MINUTE;
  if (spanMinutes >= MINUTES_PER_WEEK) {
    return true;
  }
  const spanStart = weekMinuteOf(span.start);
  const intervalStart = positiveModulo(interval.start, MINUTES_PER_WEEK);
  const intervalLength = interval.end - interval.start;
  return [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK].some((shift) => {
    const occurrenceStart = intervalStart + shift;
    return (
      occurrenceStart < spanStart + spanMinutes && spanStart < occurrenceStart + intervalLength
    );
  });
}

function weekMinuteOf(instant: Date): number {
  const minutesSinceEpoch = instant.getTime() / MILLISECONDS_PER_MINUTE;
  return positiveModulo(minutesSinceEpoch - FIRST_MONDAY_IN_MINUTES, MINUTES_PER_WEEK);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
