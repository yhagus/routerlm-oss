import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

export interface ChartPoint {
  tick: string;
  title: string;
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
  values: number[];
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

const NICE_FRACTIONS = [1, 2, 2.5, 5];

function niceStep(rough: number) {
  if (rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const nice = NICE_FRACTIONS.find((candidate) => fraction <= candidate) ?? 10;
  return nice * magnitude;
}

export function niceTicks(max: number, count = 4) {
  const step = niceStep(max / count);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
  return { ticks, max: top };
}

export function tickIndices(length: number, target = 6) {
  if (length <= target) return Array.from({ length }, (_, index) => index);
  const step = Math.ceil((length - 1) / (target - 1));
  const indices: number[] = [];
  for (let index = 0; index <= length - 1 - step; index += step) indices.push(index);
  indices.push(length - 1);
  return indices;
}

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
