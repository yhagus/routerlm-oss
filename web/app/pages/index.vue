<script setup lang="ts">
import { CloudOff, RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { compactNumber, percent, type ChartPoint, type ChartSeries } from "~/lib/chart";
import { ERROR_ORIGIN_LABELS, ERROR_ORIGINS, type ErrorOrigin } from "~/lib/errorOrigins";
import {
  bucketLabels,
  formatCostTick,
  formatRate,
  isOverviewRange,
  type Overview,
  OVERVIEW_RANGES,
  type OverviewRange,
  type OverviewStats,
} from "~/lib/overview";
import { formatCost, formatCount } from "~/lib/usage";

useHead({ title: "Overview" });

const SERIES_COLOR = "var(--series-1)";
const REQUESTS_SCALE_FLOOR = 4;
const COST_SCALE_FLOOR = 0.01;
const ERROR_RATE_SCALE_FLOOR = 0.05;
const FULL_RATE = 1;
const ORIGIN_COLORS: Record<ErrorOrigin, string> = {
  client: "var(--series-1)",
  upstream: "var(--series-2)",
  gateway: "var(--series-3)",
};

const range = useQueryParam<OverviewRange>("range", { default: "24h", isValid: isOverviewRange });
const rangeOptions = Object.entries(OVERVIEW_RANGES).map(([value, label]) => ({ value, label }));

function pickRange(value: string): void {
  if (isOverviewRange(value)) range.value = value;
}

const {
  data: overview,
  error: loadError,
  refresh,
} = useDashboardApi<Overview>("/overview", {
  query: computed(() => ({ range: range.value })),
});

type SingleStatKey = Exclude<keyof OverviewStats, "errorsByOrigin">;

interface OverviewChart {
  key: SingleStatKey;
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
];

function pointsOf(key: SingleStatKey): ChartPoint[] {
  const current = overview.value;
  if (!current) return [];
  return current.buckets.map((bucket) => ({
    ...bucketLabels(bucket.start, current.bucketSeconds),
    values: [bucket[key]],
  }));
}

const ORIGIN_SERIES: ChartSeries[] = ERROR_ORIGINS.map((origin) => ({
  key: origin,
  name: ERROR_ORIGIN_LABELS[origin],
  color: ORIGIN_COLORS[origin],
}));

const originPoints = computed<ChartPoint[]>(() => {
  const current = overview.value;
  if (!current) return [];
  return current.buckets.map((bucket) => ({
    ...bucketLabels(bucket.start, current.bucketSeconds),
    values: ERROR_ORIGINS.map((origin) => bucket.errorsByOrigin[origin].rate),
  }));
});

const bandStats = computed(() => {
  const totals = overview.value?.totals;
  return [
    { label: "Requests", value: totals ? formatCount(totals.requestCount) : null },
    { label: "Cost", value: totals ? formatCost(totals.cost) : null },
    { label: "Cache hit rate", value: totals ? formatRate(totals.cacheHitRate) : null },
    { label: "Error rate", value: totals ? formatRate(totals.errorRate) : null },
  ];
});

const originTiles = computed(() => {
  const totals = overview.value?.totals;
  return ERROR_ORIGINS.map((origin) => {
    const errors = totals?.errorsByOrigin[origin];
    return {
      origin,
      label: `${ERROR_ORIGIN_LABELS[origin]} errors`,
      rate: errors ? formatRate(errors.rate) : null,
      failed: errors ? `${formatCount(errors.count)} failed` : null,
      to: {
        path: "/usage",
        query: { errorOrigin: origin, status: "failed", range: range.value },
      },
    };
  });
});
const rangeLabel = computed(() => OVERVIEW_RANGES[range.value].toLowerCase());
</script>

<template>
  <div class="page-view">
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
      <EmptyState :icon="CloudOff" tone="error">
        <strong>Couldn't load the Overview.</strong
        ><span>Check that the backend is running, then reload the page.</span>
      </EmptyState>
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
          <NuxtLink to="/providers">Add a Provider Account</NuxtLink>{{ " "
          }}<span
            >on a Provider's Accounts tab, with the upstream API key the gateway will call.</span
          >
        </li>
        <li>
          <NuxtLink to="/models">Create a Model</NuxtLink>{{ " "
          }}<span>that routes to one of that Provider's Upstream Models.</span>
        </li>
        <li>
          <NuxtLink to="/api-keys">Create an API Key</NuxtLink>{{ " "
          }}<span>and send a request with it.</span>
        </li>
      </ol>
    </section>

    <template v-else>
      <div
        class="executive-band"
        role="group"
        :aria-label="`Totals, ${rangeLabel}`"
        :aria-busy="!overview"
      >
        <div v-for="stat in bandStats" :key="stat.label" class="executive-band__stat">
          <span>{{ stat.label }}</span
          ><strong class="tabular"
            ><template v-if="stat.value !== null">{{ stat.value }}</template
            ><AppSpinner v-else label=""
          /></strong>
        </div>
        <NuxtLink
          v-for="tile in originTiles"
          :key="tile.origin"
          :to="tile.to"
          class="executive-band__stat"
        >
          <span>{{ tile.label }}</span
          ><strong class="tabular"
            ><template v-if="tile.rate !== null">{{ tile.rate }}</template
            ><AppSpinner v-else label=""
          /></strong>
          <span v-if="tile.failed !== null" class="tabular">{{ tile.failed }}</span>
        </NuxtLink>
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
        <section class="panel">
          <header class="panel-heading">
            <div>
              <h2>Error rate</h2>
              <p>
                Failed requests ÷ all requests, stacked by who caused them. Failed means an error
                status; cancelled requests don't count as errors.
              </p>
            </div>
          </header>
          <div class="overview-chart">
            <ChartArea
              :series="ORIGIN_SERIES"
              :points="originPoints"
              :label="`Error rate by origin, ${rangeLabel}`"
              :stacked="true"
              toggleable
              :height="180"
              :format-value="(value) => percent(value)"
              :format-tick="(value) => percent(value, 0)"
              :scale-floor="ERROR_RATE_SCALE_FLOOR"
            >
              <template #tooltip="{ index, rows }">
                <ErrorOriginTooltip
                  :buckets="overview?.buckets ?? []"
                  :index="index"
                  :rows="rows"
                />
              </template>
            </ChartArea>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
