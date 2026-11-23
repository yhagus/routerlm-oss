import type { IsoWeekday, PricingWindowRange } from "@/db/schemas/index.js";
import {
  isWithinValidityPeriod,
  type ValidityPeriod,
  validityInstantsOf,
} from "./validity-period.js";
import { minuteOfDayOf, wallClockAt } from "./wall-clock.js";

/** What decides whether a Pricing Window is active: a stored window and a snapshot one both have it. */
export interface PricingWindowSchedule {
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
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

/** What decides whether one Upstream Model's Window Prices apply: their window's hours, whether it is enabled, and their Validity Period. */
export type WindowPricesHours = PricingWindowSchedule & ValidityPeriod;

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
export function doWindowPricesApplyAt(windowPrices: WindowPricesHours, instant: Date): boolean {
  return (
    isWithinValidityPeriod(windowPrices, windowPrices.timeZone, instant) &&
    isPricingWindowActiveAt(windowPrices, instant)
  );
}

export function windowPricesStatusAt(
  windowPrices: WindowPricesHours,
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
