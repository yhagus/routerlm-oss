import { formatCost } from "~/lib/usage";

/** A day of the week as ISO numbers it: Monday is 1, Sunday is 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Monday first, as the ranges editor lists them. */
export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export const WEEKDAY_SHORT_NAMES: Record<IsoWeekday, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export const WEEKDAY_NAMES: Record<IsoWeekday, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/**
 * One weekly range, in its window's time zone. Times are "HH:MM" and `end` may
 * be "24:00". An end before the start crosses midnight and belongs to the
 * weekday it starts on.
 */
export interface PricingWindowRange {
  weekdays: IsoWeekday[];
  start: string;
  end: string;
}

/** A Pricing Window as the Pricing Windows page lists it. */
export interface PricingWindow {
  id: string;
  name: string;
  /** An IANA name, such as "Asia/Shanghai". */
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
  isActiveNow: boolean;
  /** How many Upstream Models give it Window Prices, so lose them when it is deleted. */
  attachedUpstreamModelCount: number;
  createdAt: string;
  updatedAt: string;
}

/** USD per million tokens; null means the Upstream Model's standard price applies. */
export interface WindowPrices {
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
}

/**
 * Where Window Prices stand now: before their Validity Period, applying, inside
 * the period while their window is closed, or past the period's end.
 */
export const WINDOW_PRICES_STATUSES = ["scheduled", "active", "inactive", "expired"] as const;
export type WindowPricesStatus = (typeof WINDOW_PRICES_STATUSES)[number];

/** A Pricing Window attached to an Upstream Model, with its Window Prices there. */
export interface AttachedPricingWindow extends WindowPrices {
  pricingWindowId: string;
  name: string;
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
  /** The Validity Period's start, "YYYY-MM-DDTHH:MM" in the window's time zone; null is open. */
  validFrom: string | null;
  /** The Validity Period's exclusive end, as `validFrom`; null is open. */
  validUntil: string | null;
  status: WindowPricesStatus;
}

export const WINDOW_PRICE_FIELDS = [
  { key: "inputPrice", label: "Input price" },
  { key: "outputPrice", label: "Output price" },
  { key: "cacheReadPrice", label: "Cache read price" },
  { key: "cacheWritePrice", label: "Cache write price" },
] as const satisfies readonly { key: keyof WindowPrices; label: string }[];

/**
 * A Window Price and its change from the standard price, such as "$0.30 (−50%)",
 * rounded to whole percent. Undefined for a price left out, or with no standard
 * price to compare against.
 */
export function formatWindowPriceChange(
  price: number | null,
  standard: number | null,
): string | undefined {
  if (price === null || standard === null || standard === 0) return undefined;
  const percent = Math.round(((price - standard) / standard) * 100);
  return `${formatCost(price)} (${formatPercentChange(percent)})`;
}

function formatPercentChange(percent: number): string {
  if (percent < 0) return `−${-percent}%`;
  return percent > 0 ? `+${percent}%` : "0%";
}

/** "HH:MM" from 00:00 to 23:59, as the backend accepts a start. */
export const START_TIME_PATTERN = "([01][0-9]|2[0-3]):[0-5][0-9]";
/** A start time, or 24:00 for the end of the day. */
export const END_TIME_PATTERN = `${START_TIME_PATTERN}|24:00`;

/** The attachment whose Window Prices apply now; the no-overlap rule leaves at most one. */
export function activePricingWindowOf(
  attached: readonly AttachedPricingWindow[],
): AttachedPricingWindow | undefined {
  return attached.find((window) => window.status === "active");
}

/** How the Window Prices dialog badges each status. */
export const WINDOW_PRICES_STATUS_BADGES: Record<
  WindowPricesStatus,
  { label: string; tone: "good" | "warn" | "neutral"; title: string }
> = {
  scheduled: {
    label: "Scheduled",
    tone: "neutral",
    title: "Its Validity Period hasn't started yet",
  },
  active: { label: "Active now", tone: "good", title: "Its Window Prices apply now" },
  inactive: {
    label: "Window closed",
    tone: "neutral",
    title: "Inside its Validity Period, but its window isn't active now",
  },
  expired: { label: "Expired", tone: "warn", title: "Its Validity Period has ended" },
};

/** Runs this long or longer read as a span ("Mon–Fri"); shorter ones list each day. */
const MIN_WEEKDAY_SPAN = 3;

/** "Every day", "Mon–Fri", "Sat, Sun" or "Mon, Wed–Fri". */
export function formatWeekdays(weekdays: readonly IsoWeekday[]): string {
  const sorted = ISO_WEEKDAYS.filter((day) => weekdays.includes(day));
  if (sorted.length === ISO_WEEKDAYS.length) return "Every day";
  const runs: IsoWeekday[][] = [];
  for (const day of sorted) {
    const lastRun = runs.at(-1);
    if (lastRun && lastRun.at(-1) === day - 1) lastRun.push(day);
    else runs.push([day]);
  }
  return runs.flatMap(formatWeekdayRun).join(", ");
}

function formatWeekdayRun(run: IsoWeekday[]): string[] {
  const first = run[0];
  const last = run.at(-1);
  if (first === undefined || last === undefined) return [];
  if (run.length < MIN_WEEKDAY_SPAN) return run.map((day) => WEEKDAY_SHORT_NAMES[day]);
  return [`${WEEKDAY_SHORT_NAMES[first]}–${WEEKDAY_SHORT_NAMES[last]}`];
}

/** "Mon–Fri 22:00–06:00". */
export function formatRange(range: PricingWindowRange): string {
  return `${formatWeekdays(range.weekdays)} ${range.start}–${range.end}`;
}

/** Every IANA time zone this browser knows, with UTC first, for the time zone picker. */
export function ianaTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC");
  return ["UTC", ...zones];
}

/** One range row as the editor holds it; `key` only tells the rows apart while editing. */
export interface RangeForm extends PricingWindowRange {
  key: number;
}

let nextRangeKey = 0;

/** The whole week: every weekday, all day. */
export const ALWAYS_RANGE: PricingWindowRange = {
  weekdays: [...ISO_WEEKDAYS],
  start: "00:00",
  end: "24:00",
};

/** A row for `range`, or a new one covering the whole week. */
export function rangeFormFor(range: PricingWindowRange = ALWAYS_RANGE): RangeForm {
  nextRangeKey += 1;
  return { key: nextRangeKey, weekdays: [...range.weekdays], start: range.start, end: range.end };
}

/** The ranges as the API takes them, each one's weekdays Monday first. */
export function rangesFromForm(rows: readonly RangeForm[]): PricingWindowRange[] {
  return rows.map((row) => ({
    weekdays: ISO_WEEKDAYS.filter((day) => row.weekdays.includes(day)),
    start: row.start,
    end: row.end,
  }));
}
