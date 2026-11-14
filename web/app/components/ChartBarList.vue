<script setup lang="ts">
import { computed, ref } from "vue";
import { fullNumber, type BarRow, type ChartSeries } from "~/lib/chart";

const props = withDefaults(
  defineProps<{
    rows: BarRow[];
    series: ChartSeries[];
    label: string;
    formatValue?: (value: number) => string;
    /** Compact value printed at the bar's end; defaults to `formatValue`. */
    formatTotal?: (value: number) => string;
  }>(),
  { formatValue: fullNumber },
);

const active = ref<{ row: string; series: number } | null>(null);
const totals = computed(() =>
  props.rows.map((row) => row.values.reduce((sum, value) => sum + value, 0)),
);
const max = computed(() => Math.max(1, ...totals.value));
const totalText = (value: number) => (props.formatTotal ?? props.formatValue)(value);
</script>

<template>
  <div class="bar-list">
    <div v-if="series.length > 1" class="chart-legend">
      <span v-for="item in series" :key="item.key" class="chart-legend__item"
        ><i class="chart-key" :style="{ background: item.color }" />{{ item.name }}</span
      >
    </div>
    <ul class="bar-list__rows" :aria-label="label">
      <li v-for="(row, rowIndex) in rows" :key="row.key" class="bar-list__row">
        <span class="bar-list__label">{{ row.label }}</span>
        <span class="bar-list__track">
          <span class="bar-list__bar" :style="{ width: `${(totals[rowIndex]! / max) * 100}%` }">
            <span
              v-for="(value, seriesIndex) in row.values"
              :key="seriesIndex"
              class="bar-list__segment"
              :class="{
                'bar-list__segment--dim':
                  active && (active.row !== row.key || active.series !== seriesIndex),
              }"
              :style="{ flexGrow: value, background: series[seriesIndex]!.color }"
              @pointerenter="active = { row: row.key, series: seriesIndex }"
              @pointerleave="active = null"
            />
          </span>
          <span v-if="active && active.row === row.key" class="chart-tooltip bar-list__tooltip">
            <span class="chart-tooltip__title">{{ row.label }}</span>
            <span class="chart-tooltip__row"
              ><i class="chart-key" :style="{ background: series[active.series]!.color }" /><strong
                >{{ formatValue(row.values[active.series]!) }}</strong
              ><span>{{ series[active.series]!.name }}</span></span
            >
            <span v-if="series.length > 1" class="chart-tooltip__row chart-tooltip__total"
              ><strong>{{ formatValue(totals[rowIndex]!) }}</strong><span>Total</span></span
            >
          </span>
        </span>
        <span class="bar-list__value tabular"
          >{{ totalText(totals[rowIndex]!) }}<small v-if="row.note">{{ row.note }}</small></span
        >
      </li>
    </ul>
  </div>
</template>
