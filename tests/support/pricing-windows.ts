import { sql } from "drizzle-orm";
import type { IsoWeekday } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { truncateTables } from "./truncate.js";

/** Deletes every Pricing Window, and with them every Upstream Model's Window Prices. */
export async function deleteAllPricingWindows(db: Database): Promise<void> {
  await truncateTables(db, sql.raw("pricing_windows"));
}

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const NOON = 12;

/** Indexed by `Date#getUTCDay`, which counts from Sunday = 0. */
const ISO_WEEKDAY_BY_UTC_DAY: readonly IsoWeekday[] = [7, 1, 2, 3, 4, 5, 6];

const WEEKDAY_BEFORE: Readonly<Record<IsoWeekday, IsoWeekday>> = {
  1: 7,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
};

/**
 * A time zone whose wall clock reads between 12:00 and 12:59 right now, with
 * today's weekday there. Tests build their ranges around noon in it, so no
 * range has to wrap past midnight by accident, whenever they run.
 */
export function zoneAtNoonNow(now = new Date()): { timeZone: string; today: IsoWeekday } {
  const offsetHours = NOON - now.getUTCHours();
  const localNow = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);
  return {
    timeZone: etcZoneAtOffset(offsetHours),
    today: ISO_WEEKDAY_BY_UTC_DAY[localNow.getUTCDay()],
  };
}

/** The IANA `Etc` zone `offsetHours` ahead of UTC. */
function etcZoneAtOffset(offsetHours: number): string {
  if (offsetHours === 0) {
    return "Etc/GMT";
  }
  // The `Etc` names invert the sign: `Etc/GMT-5` is UTC+5.
  const invertedSign = offsetHours > 0 ? "-" : "+";
  return `Etc/GMT${invertedSign}${Math.abs(offsetHours)}`;
}

/** The weekday before `weekday`. */
export function weekdayBefore(weekday: IsoWeekday): IsoWeekday {
  return WEEKDAY_BEFORE[weekday];
}

const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

/**
 * The UTC wall clock `days` from `now`, to the minute, as a Validity Period
 * bound (`YYYY-MM-DDTHH:MM`) of a window in UTC.
 */
export function utcWallClockInDays(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 16);
}
