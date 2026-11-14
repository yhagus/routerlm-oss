<script setup lang="ts">
import { computed, ref } from "vue";
import { useElementWidth } from "~/lib/chart";

const props = withDefaults(
  defineProps<{
    values: number[];
    /** Labels aligned with `values`, shown on hover. */
    labels?: string[];
    label: string;
    formatValue?: (value: number) => string;
    height?: number;
  }>(),
  { labels: () => [], formatValue: (value: number) => String(value), height: 30 },
);

const root = ref<HTMLElement | null>(null);
const width = useElementWidth(root, 160);
const active = ref<number | null>(null);
const PAD = 5;

const range = computed(() => {
  const min = Math.min(...props.values);
  const max = Math.max(...props.values);
  return { min, span: max - min || 1 };
});
const x = (index: number) =>
  PAD + (index / Math.max(1, props.values.length - 1)) * (width.value - PAD * 2);
const y = (value: number) =>
  PAD + (props.height - PAD * 2) * (1 - (value - range.value.min) / range.value.span);

const line = computed(() =>
  props.values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(""),
);
const area = computed(
  () => `${line.value}L${x(props.values.length - 1)},${props.height}L${x(0)},${props.height}Z`,
);
const shown = computed(() => active.value ?? props.values.length - 1);

function onPointer(event: PointerEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const index = Math.round(
    ((event.clientX - rect.left - PAD) / (width.value - PAD * 2)) * (props.values.length - 1),
  );
  active.value = Math.min(props.values.length - 1, Math.max(0, index));
}
</script>

<template>
  <div ref="root" class="sparkline" :title="label">
    <svg
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      :aria-label="`${label}: latest ${formatValue(values[values.length - 1] ?? 0)}`"
      @pointermove="onPointer"
      @pointerleave="active = null"
    >
      <path :d="area" class="sparkline__area" />
      <path :d="line" class="sparkline__line" />
      <circle :cx="x(shown)" :cy="y(values[shown]!)" r="3.5" class="sparkline__dot" />
    </svg>
    <span v-if="active !== null" class="sparkline__readout"
      ><strong>{{ formatValue(values[active]!) }}</strong
      >{{ labels[active] ? ` · ${labels[active]}` : "" }}</span
    >
  </div>
</template>
