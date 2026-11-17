/** The browser's own IANA time zone, such as "Asia/Jakarta". */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "UTC+7", "UTC-3:30" or "UTC" for `timeZone` at `at`, which moves with daylight saving time. */
export function utcOffsetLabel(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((each) => each.type === "timeZoneName")?.value;
  // "GMT+7", "GMT-3:30", or "GMT" (some engines "GMT+0") at zero.
  const label = part === undefined ? "UTC" : part.replace("GMT", "UTC");
  return /^UTC[+-]0(:00)?$/.test(label) ? "UTC" : label;
}

/** The offset from UTC of `timeZone` at `at`, in minutes. */
export function utcOffsetMinutes(timeZone: string, at: Date): number {
  const label = utcOffsetLabel(timeZone, at);
  const match = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(label);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** The clock time in `timeZone`, to the minute: "08:55". */
export function clockTime(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/** The date in `timeZone`: "Nov 17". */
export function calendarDay(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric" }).format(
    at,
  );
}
