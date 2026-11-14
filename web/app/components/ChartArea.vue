<script setup lang="ts">
import { computed, ref } from "vue";
import {
  compactNumber,
  fullNumber,
  niceTicks,
  tickIndices,
  useElementWidth,
  type ChartPoint,
  type ChartSeries,
} from "~/lib/chart";

const props = withDefaults(
  defineProps<{
    series: ChartSeries[];
    points: ChartPoint[];
    /** Accessible name, e.g. "Requests per hour by provider". */
    label: string;
    height?: number;
    /** Stacked bands sum to a total; unstacked draws independent lines. */
    stacked?: boolean;
    formatValue?: (value: number) => string;
    unit?: string;
  }>(),
  { height: 232, stacked: true, formatValue: fullNumber, unit: "" },
);

const PAD = { top: 10, right: 10, bottom: 26, left: 46 };

const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root);
const active = ref<number | null>(null);

const innerWidth = computed(() => Math.max(1, width.value - PAD.left - PAD.right));
const innerHeight = computed(() => props.height - PAD.top - PAD.bottom);

/** Cumulative tops per series (stacked) or raw values (unstacked). */
const tops = computed(() =>
  props.series.map((_, seriesIndex) =>
    props.points.map((point) =>
      props.stacked
        ? point.values.slice(0, seriesIndex + 1).reduce((sum, value) => sum + value, 0)
        : point.values[seriesIndex]!,
    ),
  ),
);
const scale = computed(() => niceTicks(Math.max(1, ...tops.value.flat())));

const x = (index: number) =>
  PAD.left + (props.points.length < 2 ? 0 : (index / (props.points.length - 1)) * innerWidth.value);
const y = (value: number) => PAD.top + innerHeight.value * (1 - value / scale.value.max);

const shapes = computed(() =>
  props.series.map((series, seriesIndex) => {
    const top = tops.value[seriesIndex]!;
    const line = top.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join("");
    const base = props.stacked && seriesIndex > 0 ? tops.value[seriesIndex - 1]! : top.map(() => 0);
    const back = base
      .map((value, index) => [index, value] as const)
      .reverse()
      .map(([index, value]) => `L${x(index)},${y(value)}`)
      .join("");
    return { key: series.key, color: series.color, line, area: `${line}${back}Z` };
  }),
);

const xTicks = computed(() =>
  tickIndices(props.points.length, width.value < 480 ? 4 : 7).map((index) => ({
    index,
    x: x(index),
    label: props.points[index]!.tick,
  })),
);

const activePoint = computed(() => (active.value === null ? null : props.points[active.value]));
const tooltipRows = computed(() => {
  if (!activePoint.value) return [];
  const rows = props.series.map((series, index) => ({
    ...series,
    value: activePoint.value!.values[index]!,
  }));
  // Stacked bands read top-down, so list them in the same order.
  return props.stacked ? rows.reverse() : rows;
});
const activeTotal = computed(() =>
  activePoint.value ? activePoint.value.values.reduce((sum, value) => sum + value, 0) : 0,
);
const tooltipStyle = computed(() => {
  if (active.value === null) return {};
  const left = x(active.value);
  const flip = left > width.value * 0.6;
  return flip
    ? { right: `${width.value - left + 12}px`, top: `${PAD.top}px` }
    : { left: `${left + 12}px`, top: `${PAD.top}px` };
});

function onPointer(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const ratio = (event.clientX - rect.left - PAD.left) / innerWidth.value;
  const index = Math.round(ratio * (props.points.length - 1));
  active.value = Math.min(props.points.length - 1, Math.max(0, index));
}
function onKey(event: KeyboardEvent) {
  const last = props.points.length - 1;
  if (event.key === "ArrowRight") active.value = Math.min(last, (active.value ?? -1) + 1);
  else if (event.key === "ArrowLeft") active.value = Math.max(0, (active.value ?? last + 1) - 1);
  else if (event.key === "Escape") active.value = null;
  else return;
  event.preventDefault();
}
</script>

<template>
  <div class="chart">
    <div v-if="series.length > 1" class="chart-legend">
      <span v-for="item in series" :key="item.key" class="chart-legend__item"
        ><i class="chart-key chart-key--line" :style="{ background: item.color }" />{{
          item.name
        }}</span
      >
    </div>
    <div
      ref="root"
      class="chart-plot"
      tabindex="0"
      role="group"
      :aria-label="`${label}. Use left and right arrow keys to read values.`"
      @keydown="onKey"
      @blur="active = null"
    >
      <svg
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        aria-hidden="true"
        @pointermove="onPointer"
        @pointerleave="active = null"
      >
        <g class="chart-grid">
          <line
            v-for="tick in scale.ticks"
            :key="tick"
            :x1="PAD.left"
            :x2="width - PAD.right"
            :y1="y(tick)"
            :y2="y(tick)"
          />
        </g>
        <g class="chart-axis">
          <text
            v-for="tick in scale.ticks"
            :key="tick"
            :x="PAD.left - 8"
            :y="y(tick)"
            text-anchor="end"
            dy="0.32em"
          >
            {{ compactNumber(tick) }}
          </text>
          <text
            v-for="tick in xTicks"
            :key="tick.index"
            :x="tick.x"
            :y="height - 6"
            :text-anchor="
              tick.index === 0 ? 'start' : tick.index === points.length - 1 ? 'end' : 'middle'
            "
          >
            {{ tick.label }}
          </text>
        </g>
        <g v-for="shape in shapes" :key="shape.key">
          <path :d="shape.area" :fill="shape.color" fill-opacity="0.1" />
          <path :d="shape.line" :stroke="shape.color" class="chart-line" />
        </g>
        <g v-if="active !== null">
          <line
            class="chart-crosshair"
            :x1="x(active)"
            :x2="x(active)"
            :y1="PAD.top"
            :y2="PAD.top + innerHeight"
          />
          <circle
            v-for="(shape, index) in shapes"
            :key="shape.key"
            :cx="x(active)"
            :cy="y(tops[index]![active]!)"
            r="4"
            :fill="shape.color"
            class="chart-dot"
          />
        </g>
      </svg>
      <div v-if="activePoint" class="chart-tooltip" :style="tooltipStyle">
        <span class="chart-tooltip__title">{{ activePoint.title }}</span>
        <span v-for="row in tooltipRows" :key="row.key" class="chart-tooltip__row"
          ><i class="chart-key chart-key--line" :style="{ background: row.color }" /><strong>{{
            formatValue(row.value)
          }}</strong
          ><span>{{ row.name }}</span></span
        >
        <span v-if="stacked && series.length > 1" class="chart-tooltip__row chart-tooltip__total"
          ><strong>{{ formatValue(activeTotal) }}</strong
          ><span>Total{{ unit ? ` ${unit}` : "" }}</span></span
        >
      </div>
    </div>
    <table class="sr-only">
      <caption>
        {{ label }}
      </caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th v-for="item in series" :key="item.key" scope="col">{{ item.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="point in points" :key="point.title">
          <th scope="row">{{ point.title }}</th>
          <td v-for="(value, index) in point.values" :key="index">{{ formatValue(value) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
