import type { ChartPoint, ChartSeries } from "./chart";

export type RangeKey = "24h" | "7d" | "30d";

export const rangeOptions: { label: string; value: RangeKey }[] = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
];

export const providerSeries: ChartSeries[] = [
  { key: "OpenAI", name: "OpenAI", color: "var(--series-1)" },
  { key: "Anthropic", name: "Anthropic", color: "var(--series-2)" },
  { key: "Alibaba", name: "Alibaba", color: "var(--series-3)" },
  { key: "CommandCode", name: "CommandCode", color: "var(--series-4)" },
];

export const providerColor = (name: string) =>
  providerSeries.find((series) => series.key === name)?.color ?? "var(--bar-fill)";

export const tokenSeries: ChartSeries[] = [
  { key: "input", name: "Uncached input", color: "var(--token-input)" },
  { key: "inputCached", name: "Cached input", color: "var(--token-input-cached)" },
  { key: "output", name: "Uncached output / write", color: "var(--token-output)" },
  { key: "outputCached", name: "Cached output / write", color: "var(--token-output-cached)" },
];

const PROVIDER_SHARES = [0.443, 0.294, 0.177, 0.086];
const REQUESTS_PER_DAY = 2_840_000_000;
const SEED_BY_RANGE: Record<RangeKey, number> = { "24h": 24, "7d": 7, "30d": 30 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const diurnal = (hour: number) => 1 + 0.42 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
const weekly = (date: Date) => ([0, 6].includes(date.getUTCDay()) ? 0.74 : 1.08);

const hourLabel = (date: Date) =>
  date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekdayLabel = (date: Date) =>
  date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

interface Bucket {
  start: Date;
  hours: number;
  tick: string;
  title: string;
}

function buckets(range: RangeKey, now = new Date()): Bucket[] {
  const end = new Date(Math.floor(now.getTime() / HOUR) * HOUR);
  if (range === "24h") {
    return Array.from({ length: 24 }, (_, index) => {
      const start = new Date(end.getTime() - (23 - index) * HOUR);
      return {
        start,
        hours: 1,
        tick: hourLabel(start),
        title: `${dayLabel(start)}, ${hourLabel(start)}`,
      };
    });
  }
  if (range === "7d") {
    const anchor = Math.floor(end.getTime() / (6 * HOUR)) * 6 * HOUR;
    return Array.from({ length: 28 }, (_, index) => {
      const start = new Date(anchor - (27 - index) * 6 * HOUR);
      return {
        start,
        hours: 6,
        tick: start.getHours() < 6 ? dayLabel(start) : hourLabel(start),
        title: `${weekdayLabel(start)}, ${hourLabel(start)}`,
      };
    });
  }
  const today = Math.floor(end.getTime() / DAY) * DAY;
  return Array.from({ length: 30 }, (_, index) => {
    const start = new Date(today - (29 - index) * DAY);
    return { start, hours: 24, tick: dayLabel(start), title: weekdayLabel(start) };
  });
}

function bucketVolume(bucket: Bucket) {
  if (bucket.hours === 24) return REQUESTS_PER_DAY * weekly(bucket.start);
  let total = 0;
  for (let offset = 0; offset < bucket.hours; offset++) {
    total += diurnal((bucket.start.getUTCHours() + offset) % 24);
  }
  return (REQUESTS_PER_DAY / 24) * total * weekly(bucket.start);
}

export interface TrafficData {
  points: ChartPoint[];
  totals: number[];
  latency: number[];
  cacheHit: number[];
}

export function buildTraffic(range: RangeKey): TrafficData {
  const random = seeded(SEED_BY_RANGE[range]);
  const list = buckets(range);
  const points = list.map((bucket, index) => {
    const volume = bucketVolume(bucket);
    const degraded = index > list.length * 0.8 ? 0.72 : 1;
    const values = PROVIDER_SHARES.map((share, provider) => {
      const noise = 0.93 + random() * 0.14;
      return Math.round(volume * share * noise * (provider === 3 ? degraded : 1));
    });
    return { tick: bucket.tick, title: bucket.title, values };
  });
  const totals = points.map((point) => point.values.reduce((sum, value) => sum + value, 0));
  const latency = list.map(
    (_, index) => 780 + random() * 90 + (index > list.length * 0.8 ? 120 : 0),
  );
  const cacheHit = list.map(() => 0.36 + random() * 0.05);
  return { points, totals, latency, cacheHit };
}

export function buildDailyTokens(): ChartPoint[] {
  const random = seeded(2026);
  return buckets("30d").map((bucket) => {
    const factor = weekly(bucket.start) * (0.94 + random() * 0.12);
    return {
      tick: bucket.tick,
      title: bucket.title,
      values: [Math.round((195.7e12 / 30) * factor), Math.round((64e12 / 30) * factor)],
    };
  });
}
