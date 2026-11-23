import type { PricingWindowRange } from "@/db/schemas/index.js";
import { type ValidityPeriod, validityInstantsOf } from "./validity-period.js";
import {
  MILLISECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  minuteOfDayOf,
  utcOffsetMinutesAt,
} from "./wall-clock.js";

// The dashboard keeps a deliberately looser copy of this check in
// web/app/lib/validityPeriods.ts, to warn while the operator types; this one
// is the authority that refuses a save.

/**
 * What decides when an attachment's Window Prices can apply: its window's
 * weekly schedule and its Validity Period.
 */
export interface WindowPricesTiming extends ValidityPeriod {
  timeZone: string;
  ranges: PricingWindowRange[];
}

/** The instants from `start` (inclusive) to `end` (exclusive). */
interface InstantSpan {
  start: Date;
  end: Date;
}

/** A stretch of a UTC week in minutes from Monday 00:00 UTC, end exclusive. */
interface WeekInterval {
  start: number;
  end: number;
}

const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MILLISECONDS_PER_DAY = MINUTES_PER_DAY * MILLISECONDS_PER_MINUTE;
/** A year holds every UTC-offset combination two zones use. */
const MILLISECONDS_PER_COMPARISON = 366 * MILLISECONDS_PER_DAY;
/** 1970-01-01 was a Thursday, so the first Monday 00:00 UTC came four days later. */
const FIRST_MONDAY_IN_MINUTES = 4 * MINUTES_PER_DAY;

/**
 * Whether two attachments' Window Prices can apply at the same moment, so an
 * Upstream Model can't hold both (ADR 0040): their Validity Periods share a
 * stretch of time, and their schedules a moment within it. Whether a window
 * is enabled doesn't matter, so enabling one again never creates a conflict.
 */
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

/** The first two of `attachments` whose Window Prices can apply at the same moment. */
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

/**
 * Where to compare the schedules within the shared period from `sharedStart`
 * to `sharedEnd` (null: open-ended). A period of a year or less is compared
 * whole. A longer or open-ended one is compared over one year from its start,
 * or from now if that is later, which covers every UTC-offset combination;
 * when that year would run past its end, over its last year instead.
 */
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

/** The later of two bounds; null is open-ended, so the other one wins. */
function laterOf(first: Date | null, second: Date | null): Date | null {
  if (first === null || second === null) {
    return first ?? second;
  }
  return first > second ? first : second;
}

/** The earlier of two bounds; null is open-ended, so the other one wins. */
function earlierOf(first: Date | null, second: Date | null): Date | null {
  if (first === null || second === null) {
    return first ?? second;
  }
  return first < second ? first : second;
}

/**
 * Whether the two weekly schedules share a moment within `span`. The span is
 * cut where either zone changes its UTC offset, so each piece compares the
 * schedules under the offsets both zones show throughout it.
 */
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

/** `span` cut into pieces during which neither zone changes its UTC offset. */
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

/**
 * The instants in `span` at which `timeZone` takes a new UTC offset. Zones
 * change offset at most once a day, so a daily sample finds each change and
 * a bisection pins it to the minute.
 */
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

/** The first minute after `before`, up to `after`, that shows the offset `after` shows. */
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

/**
 * The ranges as stretches of a UTC week, for a zone `offsetMinutes` ahead of
 * UTC. A range that crosses midnight belongs to the weekday it starts on (ADR 0038).
 */
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

/**
 * Whether two stretches of the weekly cycle share a moment within `span`,
 * including across the week's end.
 */
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

/** Whether the stretch of the weekly cycle comes round at some moment in `span`. */
function doesWeekIntervalRecurDuring(interval: WeekInterval, span: InstantSpan): boolean {
  const spanMinutes = (span.end.getTime() - span.start.getTime()) / MILLISECONDS_PER_MINUTE;
  if (spanMinutes >= MINUTES_PER_WEEK) {
    return true;
  }
  const spanStart = weekMinuteOf(span.start);
  const intervalStart = positiveModulo(interval.start, MINUTES_PER_WEEK);
  const intervalLength = interval.end - interval.start;
  // Both start within one week, so the stretch's previous, own and next
  // occurrence are the only ones that can reach the span.
  return [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK].some((shift) => {
    const occurrenceStart = intervalStart + shift;
    return (
      occurrenceStart < spanStart + spanMinutes && spanStart < occurrenceStart + intervalLength
    );
  });
}

/** Minutes from the Monday 00:00 UTC before `instant`. */
function weekMinuteOf(instant: Date): number {
  const minutesSinceEpoch = instant.getTime() / MILLISECONDS_PER_MINUTE;
  return positiveModulo(minutesSinceEpoch - FIRST_MONDAY_IN_MINUTES, MINUTES_PER_WEEK);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
