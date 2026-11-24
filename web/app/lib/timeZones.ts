import { fromDate } from "@internationalized/date";

const MILLISECONDS_PER_MINUTE = 60_000;

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function utcOffsetLabel(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((each) => each.type === "timeZoneName")?.value;
  const label = part === undefined ? "UTC" : part.replace("GMT", "UTC");
  return /^UTC[+-]0(:00)?$/.test(label) ? "UTC" : label;
}

export function utcOffsetMinutes(timeZone: string, at: Date): number {
  return fromDate(at, timeZone).offset / MILLISECONDS_PER_MINUTE;
}

export function clockTime(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

export function calendarDay(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric" }).format(
    at,
  );
}
