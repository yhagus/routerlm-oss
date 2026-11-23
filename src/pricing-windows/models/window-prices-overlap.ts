import type { PricingWindowRange } from "@/db/schemas/index.js";

/** What decides when an attachment's Window Prices can apply: its window's weekly schedule. */
export interface WindowPricesTiming {
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

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MILLISECONDS_PER_DAY = MINUTES_PER_DAY * MILLISECONDS_PER_MINUTE;
const DAYS_PER_COMPARISON = 366;

/**
 * Whether two attachments' Window Prices can apply at the same moment, so an
 * Upstream Model can't hold both (ADR 0040). Whether a window is enabled
 * doesn't matter, so enabling one again never creates a conflict.
 */
export function doWindowPricesOverlap(
  first: WindowPricesTiming,
  second: WindowPricesTiming,
  now: Date,
): boolean {
  // Every attachment is open-ended, so they share all time; one year from now
  // holds every UTC-offset combination their zones use.
  const sharedSpan: InstantSpan = {
    start: now,
    end: new Date(now.getTime() + DAYS_PER_COMPARISON * MILLISECONDS_PER_DAY),
  };
  return doSchedulesShareAMoment(first, second, sharedSpan);
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
 * Whether the two weekly schedules share a moment within `span`, comparing
 * them under every combination of UTC offsets their zones use in it.
 */
function doSchedulesShareAMoment(
  first: WindowPricesTiming,
  second: WindowPricesTiming,
  span: InstantSpan,
): boolean {
  return offsetCombinationsDuring(first.timeZone, second.timeZone, span).some(
    ([firstOffset, secondOffset]) => {
      const firstIntervals = utcWeekIntervalsOf(first.ranges, firstOffset);
      const secondIntervals = utcWeekIntervalsOf(second.ranges, secondOffset);
      return firstIntervals.some((interval) =>
        secondIntervals.some((other) => doWeekIntervalsMeet(interval, other)),
      );
    },
  );
}

/** The distinct pairs of UTC offsets, in minutes, the two zones show together during `span`. */
function offsetCombinationsDuring(
  firstTimeZone: string,
  secondTimeZone: string,
  span: InstantSpan,
): Array<[number, number]> {
  const boundaries = [
    span.start,
    ...offsetChangesDuring(firstTimeZone, span),
    ...offsetChangesDuring(secondTimeZone, span),
  ];
  const combinations = new Map<string, [number, number]>();
  for (const instant of boundaries) {
    const combination: [number, number] = [
      utcOffsetMinutesAt(firstTimeZone, instant),
      utcOffsetMinutesAt(secondTimeZone, instant),
    ];
    combinations.set(combination.join(","), combination);
  }
  return [...combinations.values()];
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

/** One formatter per time zone: building one costs far more than formatting with it. */
const dateTimeFormattersByTimeZone = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormattersByTimeZone.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    dateTimeFormattersByTimeZone.set(timeZone, formatter);
  }
  return formatter;
}

/** How many minutes the wall clock in `timeZone` is ahead of UTC at `instant`. */
function utcOffsetMinutesAt(timeZone: string, instant: Date): number {
  const wholeMinute =
    Math.floor(instant.getTime() / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE;
  const parts = new Map(
    dateTimeFormatterFor(timeZone)
      .formatToParts(new Date(wholeMinute))
      .map((part) => [part.type, Number(part.value)]),
  );
  const wallClockAsUtc = Date.UTC(
    parts.get("year") ?? 0,
    (parts.get("month") ?? 1) - 1,
    parts.get("day") ?? 1,
    parts.get("hour") ?? 0,
    parts.get("minute") ?? 0,
  );
  return (wallClockAsUtc - wholeMinute) / MILLISECONDS_PER_MINUTE;
}

/** `HH:MM` as minutes since midnight; `24:00` is 1440. */
function minuteOfDayOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
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

/** Whether two stretches of the weekly cycle share a minute, including across the week's end. */
function doWeekIntervalsMeet(first: WeekInterval, second: WeekInterval): boolean {
  return [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK].some(
    (shift) => first.start < second.end + shift && second.start + shift < first.end,
  );
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
