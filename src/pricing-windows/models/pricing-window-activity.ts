import type { IsoWeekday, PricingWindowRange } from "@/db/schemas/index.js";
import {
  isWithinValidityPeriod,
  type ValidityPeriod,
  validityInstantsOf,
} from "./validity-period.js";
import { minuteOfDayOf, wallClockAt } from "./wall-clock.js";

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
  const isInStartDayPart = range.weekdays.includes(weekday) && minuteOfDay >= start;
  const isInNextDayPart = range.weekdays.includes(WEEKDAY_BEFORE[weekday]) && minuteOfDay < end;
  return isInStartDayPart || isInNextDayPart;
}

export function isPricingWindowActiveAt(window: PricingWindowSchedule, instant: Date): boolean {
  if (!window.isEnabled) {
    return false;
  }
  const { weekday, minuteOfDay } = wallClockAt(instant, window.timeZone);
  return window.ranges.some((range) => rangeCovers(range, weekday, minuteOfDay));
}

export type WindowPricesHours = PricingWindowSchedule & ValidityPeriod;

export const WINDOW_PRICES_STATUSES = ["scheduled", "active", "inactive", "expired"] as const;
export type WindowPricesStatus = (typeof WINDOW_PRICES_STATUSES)[number];

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
