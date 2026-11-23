import { sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { truncateTables } from "./truncate.js";

/** Deletes every Pricing Window, and with them every Upstream Model's Window Prices. */
export async function deleteAllPricingWindows(db: Database): Promise<void> {
  await truncateTables(db, sql.raw("pricing_windows"));
}

const MINUTES_PER_HOUR = 60;
const NOON = 12;

/**
 * A time zone whose wall clock reads between 12:00 and 12:59 right now, with
 * today's weekday there (Monday = 1). Tests build their ranges around noon in
 * it, so no range has to wrap past midnight by accident, whenever they run.
 *
 * `Etc/GMT-5` is UTC+5: the IANA `Etc` names invert the sign.
 */
export function zoneAtNoonNow(now = new Date()): { timeZone: string; today: number } {
  const offsetHours = NOON - now.getUTCHours();
  const timeZone =
    offsetHours === 0 ? "Etc/GMT" : `Etc/GMT${offsetHours > 0 ? "-" : "+"}${Math.abs(offsetHours)}`;
  const local = new Date(now.getTime() + offsetHours * MINUTES_PER_HOUR * 60_000);
  const sundayFirstWeekday = local.getUTCDay();
  return { timeZone, today: sundayFirstWeekday === 0 ? 7 : sundayFirstWeekday };
}

/** The weekday before `weekday`, Monday = 1. */
export function weekdayBefore(weekday: number): number {
  return weekday === 1 ? 7 : weekday - 1;
}
