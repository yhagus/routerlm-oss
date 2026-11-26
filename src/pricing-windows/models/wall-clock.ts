import type { IsoWeekday } from '@/db/schemas';

export const MILLISECONDS_PER_MINUTE = 60 * 1000;
export const MINUTES_PER_HOUR = 60;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const WALL_CLOCK_TEXT = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)$/;

export function parseWallClock(text: string): WallClock | undefined {
  const match = WALL_CLOCK_TEXT.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = { year, month, day, hour, minute };
  const isOnCalendar = new Date(asUtcMilliseconds(wallClock)).getUTCDate() === day;
  return isOnCalendar ? wallClock : undefined;
}

function asUtcMilliseconds(wallClock: WallClock): number {
  return Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
  );
}

export function minuteOfDayOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

const ISO_WEEKDAYS_BY_SHORT_NAME: Readonly<Record<string, IsoWeekday>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formattersByTimeZone = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formattersByTimeZone.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    formattersByTimeZone.set(timeZone, formatter);
  }
  return formatter;
}

function readWallClockAt(
  instant: Date,
  timeZone: string,
): { wallClock: WallClock; weekday: IsoWeekday } {
  const wallClock: WallClock = { year: 0, month: 1, day: 1, hour: 0, minute: 0 };
  let weekday: IsoWeekday = 1;
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type === 'weekday') weekday = ISO_WEEKDAYS_BY_SHORT_NAME[part.value];
    if (part.type === 'year') wallClock.year = Number(part.value);
    if (part.type === 'month') wallClock.month = Number(part.value);
    if (part.type === 'day') wallClock.day = Number(part.value);
    if (part.type === 'hour') wallClock.hour = Number(part.value);
    if (part.type === 'minute') wallClock.minute = Number(part.value);
  }
  return { wallClock, weekday };
}

export function wallClockAt(
  instant: Date,
  timeZone: string,
): { weekday: IsoWeekday; minuteOfDay: number } {
  const { wallClock, weekday } = readWallClockAt(instant, timeZone);
  return { weekday, minuteOfDay: wallClock.hour * MINUTES_PER_HOUR + wallClock.minute };
}

export function utcOffsetMinutesAt(timeZone: string, instant: Date): number {
  const wholeMinute =
    Math.floor(instant.getTime() / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE;
  const { wallClock } = readWallClockAt(new Date(wholeMinute), timeZone);
  return (asUtcMilliseconds(wallClock) - wholeMinute) / MILLISECONDS_PER_MINUTE;
}

export function instantOfWallClock(wallClock: string, timeZone: string): Date {
  const parsed = parseWallClock(wallClock);
  if (parsed === undefined) {
    throw new Error(`"${wallClock}" is not a wall-clock date and time (YYYY-MM-DDTHH:MM)`);
  }
  const wallClockAsUtc = asUtcMilliseconds(parsed);
  const firstGuess =
    wallClockAsUtc -
    utcOffsetMinutesAt(timeZone, new Date(wallClockAsUtc)) * MILLISECONDS_PER_MINUTE;
  const offsetAtGuess = utcOffsetMinutesAt(timeZone, new Date(firstGuess));
  return new Date(wallClockAsUtc - offsetAtGuess * MILLISECONDS_PER_MINUTE);
}
