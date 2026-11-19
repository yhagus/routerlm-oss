<script setup lang="ts">
import { computed } from "vue";
import { percent, type ChartSeries } from "~/lib/chart";
import { ERROR_ORIGINS } from "~/lib/errorOrigins";
import type { OverviewBucket } from "~/lib/overview";
import { formatCount } from "~/lib/usage";

/** The Overview error-rate chart's tooltip rows: each shown origin's rate and failed count, then the total. */
const props = defineProps<{
  buckets: OverviewBucket[];
  /** The hovered bucket's position in `buckets`. */
  index: number;
  /** The origins the chart shows, top band first. */
  rows: ChartSeries[];
}>();

const NO_DATA = "—";
const isErrorOrigin = oneOf(ERROR_ORIGINS);

function formatRate(rate: number | null): string {
  return rate === null ? NO_DATA : percent(rate);
}

function failedLabel(count: number): string {
  return `${formatCount(count)} failed`;
}

const bucket = computed(() => props.buckets[props.index]);

const originRows = computed(() => {
  const errorsByOrigin = bucket.value?.errorsByOrigin;
  if (!errorsByOrigin) return [];
  return props.rows.flatMap((row) => {
    if (!isErrorOrigin(row.key)) return [];
    const errors = errorsByOrigin[row.key];
    return [{ ...row, rate: formatRate(errors.rate), failed: failedLabel(errors.count) }];
  });
});

/**
 * The bucket's total error rate and failed count. The API sends no total failed
 * count, so it comes from the total rate, which also holds failures with no
 * recorded origin.
 */
const total = computed(() => {
  if (!bucket.value) return null;
  const { errorRate, requestCount } = bucket.value;
  return {
    rate: formatRate(errorRate),
    failed: failedLabel(Math.round((errorRate ?? 0) * requestCount)),
  };
});
</script>

<template>
  <span v-for="row in originRows" :key="row.key" class="chart-tooltip__row"
    ><i class="chart-key chart-key--line" :style="{ background: row.color }" /><strong>{{
      row.rate
    }}</strong
    ><span>{{ row.name }} · {{ row.failed }}</span></span
  >
  <span v-if="total" class="chart-tooltip__row chart-tooltip__total"
    ><strong>{{ total.rate }}</strong><span>Total · {{ total.failed }}</span></span
  >
</template>
