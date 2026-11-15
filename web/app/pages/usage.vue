<script setup lang="ts">
import { ChevronLeft, ChevronRight, CloudOff, RefreshCw, SearchX } from "@lucide/vue";
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
  type UsageSummary,
  USAGE_STATUSES,
} from "~/lib/usage";
import { type ActiveFilter, listFilterTokens } from "~/lib/activeFilters";

useHead({ title: "Usage" });

const PAGE_SIZE = 50;
/** The API Key filter's choice for the Playground's requests, which have no API Key. */
const PLAYGROUND = "playground";
/** Characters of an id shown for a Model or API Key that a link names but no longer exists. */
const SHORT_ID_LENGTH = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

/** Model and API Key ids are UUIDs; the backend rejects anything else. */
function isUuid(value: string): value is string {
  return UUID_PATTERN.test(value);
}

function isApiKeyChoice(value: string): value is string {
  return value === PLAYGROUND || isUuid(value);
}

// Filters

// Held in the URL (?range=7d&model=…&key=…&status=failed,cancelled&page=2) so a refresh or a
// link keeps them. Model, API Key and status are comma-separated lists; a log matches any pick.
const timeRange = useQueryParam<TimeRange>("range", { default: "24h", isValid: isTimeRange });
const modelFilter = useQueryList("model", { isValid: isUuid });
const apiKeyFilter = useQueryList("key", { isValid: isApiKeyChoice, order: [PLAYGROUND] });
const statusFilter = useQueryList("status", {
  isValid: oneOf(USAGE_STATUSES),
  order: USAGE_STATUSES,
});
const page = useQueryPage();
// Fixed when the range is picked (or refreshed), so paging doesn't shift the window.
const from = ref(timeRangeStart(timeRange.value, Date.now()));

function refreshTimeRange(): void {
  from.value = timeRangeStart(timeRange.value, Date.now());
}

function pickTimeRange(value: string): void {
  if (isTimeRange(value)) timeRange.value = value;
}

function clearFilters(): void {
  modelFilter.value = [];
  apiKeyFilter.value = [];
  statusFilter.value = [];
}

watch(timeRange, refreshTimeRange);
// The lists are compared as text: rewriting a link in canonical order gives new arrays with the
// same picks, which must not reset the page.
watch(
  () => [
    timeRange.value,
    modelFilter.value.join(),
    apiKeyFilter.value.join(),
    statusFilter.value.join(),
  ],
  () => {
    page.value = 1;
  },
);

const { data: modelChoices } = useDashboardApi<ModelChoice[]>("/api-keys/model-choices");
const { data: apiKeys } = useDashboardApi<ApiKeySummary[]>("/api-keys");

const timeRangeOptions = Object.entries(TIME_RANGES).map(([value, { label }]) => ({
  value,
  label,
}));
interface FilterOption {
  value: string;
  label: string;
}

/** A link can name a Model or API Key since deleted: show it so it can be unchecked. */
function missingOptions(picked: readonly string[], known: readonly FilterOption[]): FilterOption[] {
  return picked
    .filter((id) => !known.some((option) => option.value === id))
    .map((id) => ({ value: id, label: `${id.slice(0, SHORT_ID_LENGTH)} (not found)` }));
}

const modelOptions = computed(() => {
  const known = (modelChoices.value ?? []).map((model) => ({ value: model.id, label: model.name }));
  return [...known, ...missingOptions(modelFilter.value, known)];
});
const apiKeyOptions = computed(() => {
  const known = [
    { value: PLAYGROUND, label: "Playground" },
    ...(apiKeys.value ?? []).map((apiKey) => ({ value: apiKey.id, label: apiKey.name })),
  ];
  return [...known, ...missingOptions(apiKeyFilter.value, known)];
});
const statusOptions = USAGE_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));

const activeFilters = computed<ActiveFilter[]>(() => [
  ...listFilterTokens("Model", modelFilter, modelOptions.value),
  ...listFilterTokens("API Key", apiKeyFilter, apiKeyOptions.value),
  ...listFilterTokens("Status", statusFilter, statusOptions),
]);

/** The picks as one comma-separated param, or none: the backend rejects an empty list. */
function listParam(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

// With API Keys and the Playground both picked, the backend matches either.
const filterQuery = computed(() => ({
  from: from.value,
  modelId: listParam(modelFilter.value),
  apiKeyId: listParam(apiKeyFilter.value.filter((value) => value !== PLAYGROUND)),
  isPlayground: apiKeyFilter.value.includes(PLAYGROUND) ? true : undefined,
  status: listParam(statusFilter.value),
}));

// Data: both requests re-run whenever a filter or the page changes.

const {
  data: usagePage,
  error: loadError,
  status: usagePageStatus,
} = useDashboardApi<UsageLogPage>("/usage", {
  query: computed(() => ({ ...filterQuery.value, page: page.value, pageSize: PAGE_SIZE })),
});
const { data: summary, status: summaryStatus } = useDashboardApi<UsageSummary>("/usage/totals", {
  query: filterQuery,
});

/** Only the first load shows placeholders; a refetch keeps the current rows until it lands. */
const isLoadingLogs = computed(() => usagePageStatus.value === "pending" && !usagePage.value);
const logs = computed(() => usagePage.value?.items ?? []);
const total = computed(() => usagePage.value?.total ?? 0);
const firstShown = computed(() => (total.value === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1));
const lastShown = computed(() => Math.min(page.value * PAGE_SIZE, total.value));
const hasNextPage = computed(() => lastShown.value < total.value);

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

/**
 * Failed requests from a known caller have Error Captures; a request refused
 * for its API Key never does. Captures expire, so the list may be empty.
 */
function hasErrorCaptures(log: UsageLogSummary): boolean {
  return usageStatusOf(log) === "failed" && (log.apiKeyId !== null || log.isPlayground);
}
</script>

<template>
  <div class="page-view">
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
        label="Time range"
        @update:model-value="pickTimeRange"
      />
      <AppMultiSelect
        v-model="modelFilter"
        :options="modelOptions"
        label="Filter by Model"
        placeholder="All Models"
        noun="Models"
      />
      <AppMultiSelect
        v-model="apiKeyFilter"
        :options="apiKeyOptions"
        label="Filter by API Key"
        placeholder="All API Keys"
        noun="API Keys"
      />
      <AppMultiSelect
        v-model="statusFilter"
        :options="statusOptions"
        label="Filter by status"
        placeholder="Any status"
        noun="statuses"
      />
    </div>
    <ActiveFilters :filters="activeFilters" @clear-all="clearFilters" />

    <UsageSummaryBand :summary="summary" :is-loading="summaryStatus === 'pending'" />

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
            <LoadingRow v-if="isLoadingLogs" :columns="12" />
          </tbody>
        </table>
        <EmptyState v-if="loadError" :icon="CloudOff" tone="error">
          <strong>Couldn't load Usage Logs.</strong
          ><span>Check that the backend is running, then reload the page.</span>
        </EmptyState>
        <EmptyState v-else-if="!isLoadingLogs && logs.length === 0" :icon="SearchX">
          <strong>No requests match these filters.</strong
          ><span>Widen the time range or clear a filter.</span>
        </EmptyState>
      </div>
      <footer class="panel-footer">
        <AppSpinner v-if="isLoadingLogs" label="" />
        <span v-else class="tabular"
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
  </div>
</template>
