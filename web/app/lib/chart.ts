import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export interface ChartSeries {
  key: string;
  name: string;
  /** A CSS color, usually a `var(--series-*)` token so light/dark swap in CSS. */
  color: string;
}

export interface ChartPoint {
  /** Short label for the x-axis. */
  tick: string;
  /** Full label for the tooltip and the screen-reader table. */
  title: string;
  /**
   * One value per series, in series order. Null means no data (a rate over
   * zero requests): an unstacked line breaks there, a stacked band counts it as 0.
   */
  values: (number | null)[];
}

export interface Segment {
  key: string;
  name: string;
  value: number;
  color: string;
}

export interface BarRow {
  key: string;
  label: string;
  /** One value per series, in series order. */
  values: number[];
  /** Optional note after the value, e.g. a status. */
  note?: string;
}

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullFormatter = new Intl.NumberFormat("en-US");

export const compactNumber = (value: number) => compactFormatter.format(value);
export const fullNumber = (value: number) => fullFormatter.format(Math.round(value));
export const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

function niceStep(rough: number) {
  if (rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Clean y-axis ticks from 0 to a rounded maximum that covers `max`. */
export function niceTicks(max: number, count = 4) {
  const step = niceStep(max / count);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
  return { ticks, max: top };
}

/**
 * Evenly spaced indices for x-axis labels, always including the last point.
 * The last point sits at least one step after the tick before it, so their
 * labels don't overlap.
 */
export function tickIndices(length: number, target = 6) {
  if (length <= target) return Array.from({ length }, (_, index) => index);
  const step = Math.ceil((length - 1) / (target - 1));
  const indices: number[] = [];
  for (let index = 0; index <= length - 1 - step; index += step) indices.push(index);
  indices.push(length - 1);
  return indices;
}

/** Tracks an element's content width so SVG charts draw at real pixel size. */
export function useElementWidth(target: Ref<HTMLElement | null>, fallback = 600) {
  const width = ref(fallback);
  let observer: ResizeObserver | undefined;
  onMounted(() => {
    if (!target.value) return;
    width.value = target.value.clientWidth || fallback;
    observer = new ResizeObserver(([entry]) => {
      if (entry) width.value = Math.max(120, entry.contentRect.width);
    });
    observer.observe(target.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}
