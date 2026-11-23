import type { IsoWeekday, PricingWindowRange } from "@/db/schemas/index.js";
import {
  isWithinValidityPeriod,
  type ValidityPeriod,
  validityInstantsOf,
} from "./validity-period.js";

/** What decides whether a Pricing Window is active: a stored window and a snapshot one both have it. */
export interface PricingWindowSchedule {
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
}

const MINUTES_PER_HOUR = 60;

const ISO_WEEKDAYS_BY_SHORT_NAME: Readonly<Record<string, IsoWeekday>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** One formatter per time zone: building one costs far more than formatting with it. */
const formattersByTimeZone = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formattersByTimeZone.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formattersByTimeZone.set(timeZone, formatter);
  }
  return formatter;
}

/** The weekday and the minute of the day the wall clock in `timeZone` shows at `instant`. */
function wallClockAt(
  instant: Date,
  timeZone: string,
): { weekday: IsoWeekday; minuteOfDay: number } {
  let weekday: IsoWeekday = 1;
  let hour = 0;
  let minute = 0;
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type === "weekday") weekday = ISO_WEEKDAYS_BY_SHORT_NAME[part.value];
    if (part.type === "hour") hour = Number(part.value);
    if (part.type === "minute") minute = Number(part.value);
  }
  return { weekday, minuteOfDay: hour * MINUTES_PER_HOUR + minute };
}

/** `HH:MM` as minutes since midnight; `24:00` is 1440. */
function minuteOfDayOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

const WEEKDAY_BEFORE: Readonly<Record<IsoWeekday, IsoWeekday>> = {
  1: 7,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
};

function rangeCovers(range: PricingWindowRange, weekday: IsoWeekday, minuteOfDay: number): boolean {
  const start = minuteOfDayOf(range.start);
  const end = minuteOfDayOf(range.end);
  if (start < end) {
    return range.weekdays.includes(weekday) && minuteOfDay >= start && minuteOfDay < end;
  }
  // It crosses midnight and belongs to the weekday it starts on, so after
  // midnight it is yesterday's range.
  const isInStartDayPart = range.weekdays.includes(weekday) && minuteOfDay >= start;
  const isInNextDayPart = range.weekdays.includes(WEEKDAY_BEFORE[weekday]) && minuteOfDay < end;
  return isInStartDayPart || isInNextDayPart;
}

/**
 * Whether the Pricing Window is active at `instant`, read on the wall clock of
 * its time zone. A disabled window is never active. Whether its Window Prices
 * apply is `doWindowPricesApplyAt`, which also checks their Validity Period.
 */
export function isPricingWindowActiveAt(window: PricingWindowSchedule, instant: Date): boolean {
  if (!window.isEnabled) {
    return false;
  }
  const { weekday, minuteOfDay } = wallClockAt(instant, window.timeZone);
  return window.ranges.some((range) => rangeCovers(range, weekday, minuteOfDay));
}

/** What decides whether one Upstream Model's Window Prices apply: their window's schedule and their Validity Period. */
export type WindowPricesSchedule = PricingWindowSchedule & ValidityPeriod;

/**
 * Where Window Prices stand at a moment, from the clock alone (ADR 0040):
 * - `scheduled`: their Validity Period starts later;
 * - `expired`: it has ended;
 * - `active`: they apply now;
 * - `inactive`: inside the period, but their window isn't active.
 */
export const WINDOW_PRICES_STATUSES = ["scheduled", "active", "inactive", "expired"] as const;
export type WindowPricesStatus = (typeof WINDOW_PRICES_STATUSES)[number];

/**
 * Whether the Window Prices apply at `instant`: their window is enabled and
 * active, and the instant is within their Validity Period, both read on the
 * window's wall clock. Cost and the dashboard both decide with this one
 * function (ADR 0038, ADR 0040).
 */
export function doWindowPricesApplyAt(windowPrices: WindowPricesSchedule, instant: Date): boolean {
  return (
    isWithinValidityPeriod(windowPrices, windowPrices.timeZone, instant) &&
    isPricingWindowActiveAt(windowPrices, instant)
  );
}

export function windowPricesStatusAt(
  windowPrices: WindowPricesSchedule,
  instant: Date,
): WindowPricesStatus {
  const { start, end } = validityInstantsOf(windowPrices, windowPrices.timeZone);
  if (start !== null && instant < start) {
    return "scheduled";
  }
  if (end !== null && instant >= end) {
    return "expired";
  }
  return doWindowPricesApplyAt(windowPrices, instant) ? "active" : "inactive";
}
