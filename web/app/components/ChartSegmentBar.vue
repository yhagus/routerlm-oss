<script setup lang="ts">
import { computed, ref } from 'vue';
import { fullNumber, percent, type Segment } from '~/lib/chart';

const props = withDefaults(
  defineProps<{
    segments: Segment[];
    label: string;
    formatValue?: (value: number) => string;
    legend?: boolean;
  }>(),
  { formatValue: fullNumber, legend: true },
);

const active = ref<string | null>(null);
const total = computed(() => props.segments.reduce((sum, segment) => sum + segment.value, 0) || 1);
const rows = computed(() =>
  props.segments.map((segment) => ({ ...segment, share: segment.value / total.value })),
);
const activeRow = computed(() => rows.value.find((row) => row.key === active.value));
</script>

<template>
  <div class="segment-chart">
    <div class="segment-bar" role="img" :aria-label="label">
      <span
        v-for="row in rows"
        :key="row.key"
        class="segment-bar__part"
        :class="{ 'segment-bar__part--dim': active && active !== row.key }"
        :style="{ flexGrow: row.share, background: row.color }"
        @pointerenter="active = row.key"
        @pointerleave="active = null"
      />
      <div v-if="activeRow" class="chart-tooltip segment-bar__tooltip">
        <span class="chart-tooltip__row"
          ><i class="chart-key" :style="{ background: activeRow.color }" /><strong>{{
            formatValue(activeRow.value)
          }}</strong
          ><span>{{ activeRow.name }} · {{ percent(activeRow.share) }}</span></span
        >
      </div>
    </div>
    <dl v-if="legend" class="segment-legend">
      <div
        v-for="row in rows"
        :key="row.key"
        :class="{ 'segment-legend__row--active': active === row.key }"
        @pointerenter="active = row.key"
        @pointerleave="active = null"
      >
        <dt><i class="chart-key" :style="{ background: row.color }" />{{ row.name }}</dt>
        <dd>
          <span class="tabular">{{ formatValue(row.value) }}</span
          ><span class="segment-legend__share tabular">{{ percent(row.share) }}</span>
        </dd>
      </div>
    </dl>
  </div>
</template>
