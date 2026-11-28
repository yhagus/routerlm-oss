import type { INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { IsoWeekday } from '@/db/schemas';
import { truncateTables } from './truncate';

export async function deleteAllPricingWindows(app: INestApplicationContext): Promise<void> {
  await truncateTables(app, sql.raw('pricing_windows'));
}

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const NOON = 12;

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

export function zoneAtNoonNow(now = new Date()): { timeZone: string; today: IsoWeekday } {
  const offsetHours = NOON - now.getUTCHours();
  const localNow = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);
  return {
    timeZone: etcZoneAtOffset(offsetHours),
    today: ISO_WEEKDAY_BY_UTC_DAY[localNow.getUTCDay()],
  };
}

function etcZoneAtOffset(offsetHours: number): string {
  if (offsetHours === 0) {
    return 'Etc/GMT';
  }
  const invertedSign = offsetHours > 0 ? '-' : '+';
  return `Etc/GMT${invertedSign}${Math.abs(offsetHours)}`;
}

export function weekdayBefore(weekday: IsoWeekday): IsoWeekday {
  return WEEKDAY_BEFORE[weekday];
}

const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

export function utcWallClockInDays(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 16);
}
