<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { compactNumber, percent, type ChartPoint } from "~/lib/chart";
import {
  bucketLabels,
  formatCostTick,
  isOverviewRange,
  type Overview,
  OVERVIEW_RANGES,
  type OverviewRange,
  type OverviewStats,
} from "~/lib/overview";
import { formatCost, formatCount } from "~/lib/usage";

useHead({ title: "Overview" });

const SERIES_COLOR = "var(--series-1)";
const NO_DATA = "—";
// Floors for the y-axis, so a quiet range isn't stretched to the full height.
const REQUESTS_SCALE_FLOOR = 4;
const COST_SCALE_FLOOR = 0.01;
const ERROR_RATE_SCALE_FLOOR = 0.05;
const FULL_RATE = 1;

const range = useQueryParam<OverviewRange>("range", { default: "24h", isValid: isOverviewRange });
const rangeOptions = Object.entries(OVERVIEW_RANGES).map(([value, label]) => ({ value, label }));

function pickRange(value: string): void {
  if (isOverviewRange(value)) range.value = value;
}

const {
  data: overview,
  error: loadError,
  refresh,
} = await useDashboardApi<Overview>("/overview", {
  query: computed(() => ({ range: range.value })),
});

function formatRate(rate: number | null): string {
  return rate === null ? NO_DATA : percent(rate);
}

interface OverviewChart {
  key: keyof OverviewStats;
  title: string;
  description: string;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  scaleFloor: number;
}

const CHARTS: OverviewChart[] = [
  {
    key: "requestCount",
    title: "Requests",
    description: "Client requests received, whatever their outcome.",
    formatValue: formatCount,
    formatTick: compactNumber,
    scaleFloor: REQUESTS_SCALE_FLOOR,
  },
  {
    key: "cost",
    title: "Cost",
    description:
      "At the prices in force when each request was served. Unknown Costs count as zero.",
    formatValue: formatCost,
    formatTick: formatCostTick,
    scaleFloor: COST_SCALE_FLOOR,
  },
  {
    key: "cacheHitRate",
    title: "Cache hit rate",
    description:
      "Cache-read tokens ÷ total input tokens, where total input = input + cache-read + cache-write tokens.",
    formatValue: (value) => percent(value),
    formatTick: (value) => percent(value, 0),
    scaleFloor: FULL_RATE,
  },
  {
    key: "errorRate",
    title: "Error rate",
    description:
      "Failed requests ÷ all requests. Failed means an error status; cancelled requests don't count as errors.",
    formatValue: (value) => percent(value),
    formatTick: (value) => percent(value, 0),
    scaleFloor: ERROR_RATE_SCALE_FLOOR,
  },
];

function pointsOf(key: keyof OverviewStats): ChartPoint[] {
  const current = overview.value;
  if (!current) return [];
  return current.buckets.map((bucket) => ({
    ...bucketLabels(bucket.start, current.bucketSeconds),
    values: [bucket[key]],
  }));
}

const totals = computed(() => overview.value?.totals);
const rangeLabel = computed(() => OVERVIEW_RANGES[range.value].toLowerCase());
</script>

<template>
  <PageHeading
    title="Overview"
    description="Requests, Cost, cache hit rate and error rate across the gateway."
  >
    <AppSelect
      :model-value="range"
      :options="rangeOptions"
      label="Time range"
      @update:model-value="pickRange"
    />
    <button class="button button--quiet" type="button" @click="refresh()">
      <RefreshCw :size="14" /> Refresh
    </button>
  </PageHeading>

  <section v-if="loadError" class="panel">
    <div class="empty-state">
      <strong>Couldn't load the Overview.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </div>
  </section>

  <section v-else-if="overview && !overview.hasUsageLogs" class="panel">
    <header class="panel-heading">
      <div>
        <h2>No requests yet</h2>
        <p>The charts fill in once the gateway serves its first request. To get there:</p>
      </div>
    </header>
    <ol class="setup-steps">
      <li>
        <NuxtLink to="/provider-accounts">Add a Provider Account</NuxtLink>
        <span>with the upstream API key the gateway will call.</span>
      </li>
      <li>
        <NuxtLink to="/models">Create a Model</NuxtLink>
        <span>that routes to one of that Provider's Upstream Models.</span>
      </li>
      <li>
        <NuxtLink to="/api-keys">Create an API Key</NuxtLink>
        <span>and send a request with it.</span>
      </li>
    </ol>
  </section>

  <template v-else-if="overview && totals">
    <div class="executive-band" role="group" :aria-label="`Totals, ${rangeLabel}`">
      <div class="executive-band__stat">
        <span>Requests</span><strong class="tabular">{{ formatCount(totals.requestCount) }}</strong>
      </div>
      <div class="executive-band__stat">
        <span>Cost</span><strong class="tabular">{{ formatCost(totals.cost) }}</strong>
      </div>
      <div class="executive-band__stat">
        <span>Cache hit rate</span
        ><strong class="tabular">{{ formatRate(totals.cacheHitRate) }}</strong>
      </div>
      <div class="executive-band__stat">
        <span>Error rate</span><strong class="tabular">{{ formatRate(totals.errorRate) }}</strong>
      </div>
    </div>

    <div class="overview-charts">
      <section v-for="chart in CHARTS" :key="chart.key" class="panel">
        <header class="panel-heading">
          <div>
            <h2>{{ chart.title }}</h2>
            <p>{{ chart.description }}</p>
          </div>
        </header>
        <div class="overview-chart">
          <ChartArea
            :series="[{ key: chart.key, name: chart.title, color: SERIES_COLOR }]"
            :points="pointsOf(chart.key)"
            :label="`${chart.title}, ${rangeLabel}`"
            :stacked="false"
            :height="180"
            :format-value="chart.formatValue"
            :format-tick="chart.formatTick"
            :scale-floor="chart.scaleFloor"
          />
        </div>
      </section>
    </div>
  </template>
</template>
