<script setup lang="ts">
import { ChevronLeft, ChevronRight, RefreshCw } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { ApiKeySummary, ModelChoice } from "~/lib/api-keys";
import {
  formatCost,
  formatCount,
  formatDuration,
  isTimeRange,
  TIME_RANGES,
  type TimeRange,
  timeRangeStart,
  type UsageLogPage,
  type UsageLogSummary,
  type UsageStatus,
  usageStatusOf,
  type UsageTotal,
  type UsageTotals,
} from "~/lib/usage";

useHead({ title: "Usage" });

const PAGE_SIZE = 50;
const ALL = "all";
/** The API Key filter's choice for the Playground's requests, which have no API Key. */
const PLAYGROUND = "playground";
const STATUS_LABELS = {
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
} as const satisfies Record<UsageStatus, string>;
const STATUS_BADGES = {
  succeeded: "status-badge--good",
  failed: "status-badge--bad",
  cancelled: "status-badge--warn",
} as const satisfies Record<UsageStatus, string>;

// Filters

const timeRange = ref<TimeRange>("24h");
const modelFilter = ref(ALL);
const apiKeyFilter = ref(ALL);
const statusFilter = ref(ALL);
const page = ref(1);
// Fixed when the range is picked (or refreshed), so paging doesn't shift the window.
const from = ref(timeRangeStart(timeRange.value, Date.now()));

function refreshTimeRange(): void {
  from.value = timeRangeStart(timeRange.value, Date.now());
}

function pickTimeRange(value: string): void {
  if (isTimeRange(value)) timeRange.value = value;
}

watch(timeRange, refreshTimeRange);
watch([timeRange, modelFilter, apiKeyFilter, statusFilter], () => {
  page.value = 1;
});

const { data: modelChoices } = await useDashboardApi<ModelChoice[]>("/api-keys/model-choices");
const { data: apiKeys } = await useDashboardApi<ApiKeySummary[]>("/api-keys");

const timeRangeOptions = Object.entries(TIME_RANGES).map(([value, { label }]) => ({
  value,
  label,
}));
const modelOptions = computed(() => [
  { value: ALL, label: "All Models" },
  ...(modelChoices.value ?? []).map((model) => ({ value: model.id, label: model.name })),
]);
const apiKeyOptions = computed(() => [
  { value: ALL, label: "All API Keys" },
  { value: PLAYGROUND, label: "Playground" },
  ...(apiKeys.value ?? []).map((apiKey) => ({ value: apiKey.id, label: apiKey.name })),
]);
const statusOptions = [
  { value: ALL, label: "Any status" },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

function chosen(value: string): string | undefined {
  return value === ALL ? undefined : value;
}

const filterQuery = computed(() => ({
  from: from.value,
  modelId: chosen(modelFilter.value),
  apiKeyId: apiKeyFilter.value === PLAYGROUND ? undefined : chosen(apiKeyFilter.value),
  isPlayground: apiKeyFilter.value === PLAYGROUND ? true : undefined,
  status: chosen(statusFilter.value),
}));

// Data: both requests re-run whenever a filter or the page changes.

const { data: usagePage, error: loadError } = await useDashboardApi<UsageLogPage>("/usage", {
  query: computed(() => ({ ...filterQuery.value, page: page.value, pageSize: PAGE_SIZE })),
});
const { data: totals } = await useDashboardApi<UsageTotals>("/usage/totals", {
  query: filterQuery,
});

const logs = computed(() => usagePage.value?.items ?? []);
const total = computed(() => usagePage.value?.total ?? 0);
const firstShown = computed(() => (total.value === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1));
const lastShown = computed(() => Math.min(page.value * PAGE_SIZE, total.value));
const hasNextPage = computed(() => lastShown.value < total.value);

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

const totalGroups = computed(() => [
  { title: "By Model", rows: totals.value?.byModel ?? [], missing: "No Model" },
  { title: "By API Key", rows: totals.value?.byApiKey ?? [], missing: "No API Key" },
]);

/**
 * Failed requests from a known caller have Error Captures; a request refused
 * for its API Key never does. Captures expire, so the list may be empty.
 */
function hasErrorCaptures(log: UsageLogSummary): boolean {
  return usageStatusOf(log) === "failed" && (log.apiKeyId !== null || log.isPlayground);
}

/** A totals row's name; logs whose Model or API Key is gone (or never known) group under `whenMissing`. */
function totalName(total: UsageTotal, whenMissing: string): string {
  return total.name ?? whenMissing;
}
</script>

<template>
  <PageHeading
    title="Usage"
    description="One Usage Log per client request: tokens, Cost, latency and outcome."
  >
    <button class="button button--quiet" type="button" @click="refreshTimeRange">
      <RefreshCw :size="14" /> Refresh
    </button>
  </PageHeading>

  <div class="usage-filters" role="group" aria-label="Filter Usage Logs">
    <AppSelect
      :model-value="timeRange"
      :options="timeRangeOptions"
      aria-label="Time range"
      @update:model-value="pickTimeRange"
    />
    <AppSelect v-model="modelFilter" :options="modelOptions" aria-label="Filter by Model" />
    <AppSelect v-model="apiKeyFilter" :options="apiKeyOptions" aria-label="Filter by API Key" />
    <AppSelect v-model="statusFilter" :options="statusOptions" aria-label="Filter by status" />
  </div>

  <div class="usage-totals">
    <section v-for="group in totalGroups" :key="group.title" class="panel table-panel">
      <header class="panel-heading">
        <div>
          <h2>{{ group.title }}</h2>
          <p>Totals over the filtered requests. Unreported tokens count as zero.</p>
        </div>
      </header>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Requests</th>
              <th>Input</th>
              <th>Output</th>
              <th>Cache read</th>
              <th>Cache write</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="row.id ?? 'none'">
              <td>
                <strong>{{ totalName(row, group.missing) }}</strong>
              </td>
              <td class="tabular">{{ formatCount(row.requestCount) }}</td>
              <td class="tabular">{{ formatCount(row.inputTokens) }}</td>
              <td class="tabular">{{ formatCount(row.outputTokens) }}</td>
              <td class="tabular">{{ formatCount(row.cacheReadTokens) }}</td>
              <td class="tabular">{{ formatCount(row.cacheWriteTokens) }}</td>
              <td class="tabular">{{ formatCost(row.cost) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="group.rows.length === 0" class="empty-state">
          <strong>No requests in this range.</strong>
        </div>
      </div>
    </section>
  </div>

  <section class="panel table-panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Model</th>
            <th>API Key</th>
            <th>Status</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache read</th>
            <th>Cache write</th>
            <th>Cost</th>
            <th>First token</th>
            <th>Duration</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td class="tabular">{{ timeFormat.format(new Date(log.createdAt)) }}</td>
            <td>{{ log.modelName ?? (log.modelId ? "Deleted Model" : "—") }}</td>
            <td>
              {{
                log.isPlayground
                  ? "Playground"
                  : (log.apiKeyName ?? (log.apiKeyId ? "Deleted API Key" : "—"))
              }}
            </td>
            <td>
              <span class="status-badge" :class="STATUS_BADGES[usageStatusOf(log)]">
                {{ STATUS_LABELS[usageStatusOf(log)] }} · {{ log.errorCode ?? log.httpStatus }}
              </span>
              <span v-if="log.isIncomplete" class="cell-note">Incomplete usage</span>
              <NuxtLink
                v-if="hasErrorCaptures(log)"
                class="cell-note"
                :to="`/error-captures?usageLogId=${log.id}`"
                >Error Captures</NuxtLink
              >
            </td>
            <td class="tabular">{{ formatCount(log.inputTokens) }}</td>
            <td class="tabular">{{ formatCount(log.outputTokens) }}</td>
            <td class="tabular">{{ formatCount(log.cacheReadTokens) }}</td>
            <td class="tabular">{{ formatCount(log.cacheWriteTokens) }}</td>
            <td class="tabular">{{ formatCost(log.cost) }}</td>
            <td class="tabular">{{ formatDuration(log.timeToFirstTokenMs) }}</td>
            <td class="tabular">{{ formatDuration(log.durationMs) }}</td>
            <td class="tabular">{{ log.attemptCount }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="loadError" class="empty-state">
        <strong>Couldn't load Usage Logs.</strong
        ><span>Check that the backend is running, then reload the page.</span>
      </div>
      <div v-else-if="logs.length === 0" class="empty-state">
        <strong>No requests match these filters.</strong
        ><span>Widen the time range or clear a filter.</span>
      </div>
    </div>
    <footer class="panel-footer">
      <span class="tabular"
        >{{ formatCount(firstShown) }}–{{ formatCount(lastShown) }} of
        {{ formatCount(total) }}</span
      >
      <div class="row-actions">
        <button class="row-action" type="button" :disabled="page === 1" @click="page -= 1">
          <ChevronLeft :size="14" /> Previous
        </button>
        <button class="row-action" type="button" :disabled="!hasNextPage" @click="page += 1">
          Next <ChevronRight :size="14" />
        </button>
      </div>
    </footer>
  </section>
</template>
