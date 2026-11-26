<script setup lang="ts">
import { computed } from 'vue';
import type { ChartSeries } from '~/lib/chart';
import { ERROR_ORIGINS } from '~/lib/errorOrigins';
import { formatRate, type OverviewBucket } from '~/lib/overview';
import { formatCount } from '~/lib/usage';

const props = defineProps<{
  buckets: OverviewBucket[];
  index: number;
  rows: ChartSeries[];
}>();

const isErrorOrigin = oneOf(ERROR_ORIGINS);

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
</script>

<template>
  <ChartTooltipRow
    v-for="row in originRows"
    :key="row.key"
    :color="row.color"
    :value="row.rate"
    :label="`${row.name} · ${row.failed}`"
  />
  <ChartTooltipRow
    v-if="bucket"
    total
    :value="formatRate(bucket.errorRate)"
    :label="`Total · ${failedLabel(bucket.failedCount)}`"
  />
</template>
