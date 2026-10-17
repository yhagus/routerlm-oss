<script setup lang="ts">
import { computed, ref } from "vue";
import { number } from "@/lib/format";
import Skeleton from "@/components/ui/skeleton.vue";
import TabSwitcher from "@/components/ui/tab-switcher.vue";
import type { UsageTrend } from "@/types/api";

type Metric = "tokens" | "requests";

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    trend?: UsageTrend;
    loading?: boolean;
    variant?: "bar" | "line";
  }>(),
  { loading: false, description: "", variant: "bar" },
);

const OTHER_ID = "__other__";
const metric = ref<Metric>("tokens");
const metricOptions = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
] as const;
const hovered = ref<number | null>(null);

const series = computed(() =>
  (props.trend?.series || []).map((item, index) => ({
    id: item.id,
    label:
      item.id === OTHER_ID ? "Other" : props.trend?.names?.[item.id] || item.id,
    values: item[metric.value],
    // --chart-N tokens cycle; "Other" is always the muted tone.
    color:
      item.id === OTHER_ID
        ? "var(--muted-foreground)"
        : `var(--chart-${(index % 6) + 1})`,
  })),
);
const labels = computed(() => props.trend?.labels || []);
const totals = computed(() =>
  labels.value.map((_, bucket) =>
    series.value.reduce((sum, item) => sum + (item.values[bucket] || 0), 0),
  ),
);
const isLine = computed(() => props.variant === "line");
// Line charts plot each series on its own, so scale to the largest single value.
const max = computed(() =>
  isLine.value
    ? Math.max(1, ...series.value.flatMap((item) => item.values))
    : Math.max(1, ...totals.value),
);
const xAt = (bucket: number) =>
  labels.value.length ? ((bucket + 0.5) / labels.value.length) * 100 : 0;
const yAt = (value: number) => 100 - (value / max.value) * 100;
const linePaths = computed(() =>
  series.value.map((item) => ({
    id: item.id,
    color: item.color,
    points: labels.value
      .map((_, bucket) => `${xAt(bucket)},${yAt(item.values[bucket] || 0)}`)
      .join(" "),
  })),
);
const grandTotal = computed(() => totals.value.reduce((a, b) => a + b, 0));
const hasData = computed(() => grandTotal.value > 0);
// Show roughly six axis labels no matter how many buckets exist.
const labelStep = computed(() =>
  Math.max(1, Math.ceil(labels.value.length / 6)),
);
const hoveredRows = computed(() => {
  const bucket = hovered.value;
  if (bucket === null) return [];
  return series.value
    .map((item) => ({ ...item, value: item.values[bucket] || 0 }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
});
</script>

<template>
  <section class="rounded-[10px] border bg-card p-5">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div class="min-w-0">
        <h2 class="truncate text-base font-semibold">{{ title }}</h2>
        <p v-if="description" class="mt-1 text-xs text-muted-foreground">
          {{ description }}
        </p>
      </div>
      <TabSwitcher v-model="metric" :options="metricOptions" class="shrink-0" />
    </div>

    <div
      v-if="loading && !trend"
      class="mt-5 space-y-3"
      role="status"
      aria-label="Loading chart"
    >
      <Skeleton class="h-48 w-full" />
      <div class="flex gap-3">
        <Skeleton v-for="item in 4" :key="item" class="h-3.5 w-24" />
      </div>
    </div>

    <div
      v-else-if="!hasData"
      class="mt-5 flex h-48 flex-col items-center justify-center rounded-lg border border-dashed text-center"
    >
      <p class="text-sm font-medium">No traffic in this period</p>
      <p class="mt-1 max-w-xs text-xs text-muted-foreground">
        Pick a longer period or send requests through the gateway.
      </p>
    </div>

    <div v-else class="mt-5">
      <div class="relative">
        <div
          class="flex h-48 items-end gap-px border-b sm:gap-0.5"
          :class="loading ? 'opacity-60 transition-opacity' : ''"
          role="img"
          :aria-label="`${title}: ${number(grandTotal)} ${metric}`"
          @mouseleave="hovered = null"
        >
          <div
            v-for="(label, bucket) in labels"
            :key="`${label}-${bucket}`"
            class="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
            @mouseenter="hovered = bucket"
            @focusin="hovered = bucket"
          >
            <div
              v-if="!isLine"
              class="flex flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity"
              :class="
                hovered !== null && hovered !== bucket ? 'opacity-50' : ''
              "
              :style="{
                height: `${Math.max(totals[bucket] ? 2 : 0, (totals[bucket] / max) * 100)}%`,
              }"
            >
              <div
                v-for="item in series"
                :key="item.id"
                :style="{
                  background: item.color,
                  flexGrow: item.values[bucket] || 0,
                  flexBasis: 0,
                }"
              />
            </div>
          </div>
        </div>

        <template v-if="isLine">
          <svg
            class="pointer-events-none absolute inset-x-0 top-0 h-48 w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              v-for="line in linePaths"
              :key="line.id"
              :points="line.points"
              fill="none"
              :stroke="line.color"
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <template v-if="hovered !== null">
            <div
              class="pointer-events-none absolute top-0 h-48 w-px bg-border"
              :style="{ left: `${xAt(hovered)}%` }"
            />
            <span
              v-for="item in series"
              :key="item.id"
              class="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
              :style="{
                left: `${xAt(hovered)}%`,
                top: `${(yAt(item.values[hovered] || 0) / 100) * 12}rem`,
                background: item.color,
              }"
            />
          </template>
        </template>

        <div
          v-if="hovered !== null && hoveredRows.length"
          class="pointer-events-none absolute top-0 z-10 w-56 max-w-[70vw] rounded-lg border bg-popover p-2.5 text-xs shadow-lg"
          :class="
            hovered > labels.length / 2
              ? 'right-2 sm:right-4'
              : 'left-2 sm:left-4'
          "
        >
          <p class="mb-1.5 font-medium">{{ labels[hovered] }}</p>
          <ul class="space-y-1">
            <li
              v-for="row in hoveredRows.slice(0, 6)"
              :key="row.id"
              class="flex items-center gap-2"
            >
              <span
                class="size-2 shrink-0 rounded-sm"
                :style="{ background: row.color }"
              />
              <span class="min-w-0 flex-1 truncate" :title="row.label">{{
                row.label
              }}</span>
              <span class="shrink-0 font-mono tabular-nums">{{
                number(row.value)
              }}</span>
            </li>
          </ul>
          <p
            class="mt-1.5 flex justify-between border-t pt-1.5 text-muted-foreground"
          >
            <span>Total</span
            ><span class="font-mono tabular-nums">{{
              number(totals[hovered])
            }}</span>
          </p>
        </div>
      </div>

      <div
        class="mt-1.5 flex gap-px text-[10px] text-muted-foreground sm:gap-0.5"
      >
        <span
          v-for="(label, bucket) in labels"
          :key="`axis-${bucket}`"
          class="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center"
        >
          <template v-if="bucket % labelStep === 0">{{ label }}</template>
        </span>
      </div>

      <ul class="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        <li
          v-for="item in series"
          :key="item.id"
          class="flex min-w-0 max-w-full items-center gap-1.5"
        >
          <span
            class="size-2 shrink-0 rounded-sm"
            :style="{ background: item.color }"
          />
          <span class="max-w-[14rem] truncate" :title="item.label">{{
            item.label
          }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
