import { formatCost } from "~/lib/usage";

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

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

export interface PricingWindowRange {
  weekdays: IsoWeekday[];
  start: string;
  end: string;
}

export interface PricingWindow {
  id: string;
  name: string;
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
  isActiveNow: boolean;
  attachedUpstreamModelCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WindowPrices {
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
}

export const WINDOW_PRICES_STATUSES = ["scheduled", "active", "inactive", "expired"] as const;
export type WindowPricesStatus = (typeof WINDOW_PRICES_STATUSES)[number];

export interface AttachedPricingWindow extends WindowPrices {
  pricingWindowId: string;
  name: string;
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
  validFrom: string | null;
  validUntil: string | null;
  status: WindowPricesStatus;
}

export const WINDOW_PRICE_FIELDS = [
  { key: "inputPrice", label: "Input price" },
  { key: "outputPrice", label: "Output price" },
  { key: "cacheReadPrice", label: "Cache read price" },
  { key: "cacheWritePrice", label: "Cache write price" },
] as const satisfies readonly { key: keyof WindowPrices; label: string }[];

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

export const START_TIME_PATTERN = "([01][0-9]|2[0-3]):[0-5][0-9]";
export const END_TIME_PATTERN = `${START_TIME_PATTERN}|24:00`;

export function activePricingWindowOf(
  attached: readonly AttachedPricingWindow[],
): AttachedPricingWindow | undefined {
  return attached.find((window) => window.status === "active");
}

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

const MIN_WEEKDAY_SPAN = 3;

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

export function formatRange(range: PricingWindowRange): string {
  return `${formatWeekdays(range.weekdays)} ${range.start}–${range.end}`;
}

export function ianaTimeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC");
  return ["UTC", ...zones];
}

export interface RangeForm extends PricingWindowRange {
  key: number;
}

let nextRangeKey = 0;

export const ALWAYS_RANGE: PricingWindowRange = {
  weekdays: [...ISO_WEEKDAYS],
  start: "00:00",
  end: "24:00",
};

export function rangeFormFor(range: PricingWindowRange = ALWAYS_RANGE): RangeForm {
  nextRangeKey += 1;
  return { key: nextRangeKey, weekdays: [...range.weekdays], start: range.start, end: range.end };
}

export function rangesFromForm(rows: readonly RangeForm[]): PricingWindowRange[] {
  return rows.map((row) => ({
    weekdays: ISO_WEEKDAYS.filter((day) => row.weekdays.includes(day)),
    start: row.start,
    end: row.end,
  }));
}
