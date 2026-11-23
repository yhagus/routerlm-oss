// Converts between instants and the wall clock of an IANA time zone.

const MILLISECONDS_PER_MINUTE = 60 * 1000;

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
export function utcOffsetMinutesAt(timeZone: string, instant: Date): number {
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

/**
 * The instant at which the wall clock in `timeZone` reads `wallClock`
 * (`YYYY-MM-DDTHH:MM`). A time the clock skips or shows twice around a DST
 * change resolves to an instant within that change's hour.
 */
export function instantOfWallClock(wallClock: string, timeZone: string): Date {
  const wallClockAsUtc = new Date(`${wallClock}:00Z`).getTime();
  // The offset at the guess is right unless an offset change lies between
  // the guess and the answer; a second look settles that.
  const firstGuess =
    wallClockAsUtc -
    utcOffsetMinutesAt(timeZone, new Date(wallClockAsUtc)) * MILLISECONDS_PER_MINUTE;
  const offsetAtGuess = utcOffsetMinutesAt(timeZone, new Date(firstGuess));
  return new Date(wallClockAsUtc - offsetAtGuess * MILLISECONDS_PER_MINUTE);
}
