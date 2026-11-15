<script setup lang="ts">
import { SearchX } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
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
import { DATA_TABLE_PAGE_SIZE, type DataTableColumn } from "~/lib/dataTable";
import { dateTimeFormat } from "~/lib/dateFormats";

useHead({ title: "Usage" });

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

// Held in the URL (?range=7d&model=…&key=…&status=failed,cancelled) so a refresh or a link keeps
// them. Model, API Key and status are comma-separated lists; a log matches any pick. The DataTable
// holds the search (?q=) and page (?page=) the same way; this page reads them for its requests.
const timeRange = useQueryParam<TimeRange>("range", { default: "24h", isValid: isTimeRange });
const modelFilter = useQueryList("model", { isValid: isUuid });
const apiKeyFilter = useQueryList("key", { isValid: isApiKeyChoice, order: [PLAYGROUND] });
const statusFilter = useQueryList("status", {
  isValid: oneOf(USAGE_STATUSES),
  order: USAGE_STATUSES,
});
const search = useQuerySearch();
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

// The DataTable returns to page 1 when the search or a filter token changes; the time range has no
// token, so it does that here.
watch(timeRange, () => {
  refreshTimeRange();
  page.value = 1;
});

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
  q: search.value.trim() || undefined,
}));

// Data: both requests re-run whenever the search, a filter or the page changes.

const {
  data: usagePage,
  error: loadError,
  status: usagePageStatus,
  refresh: refreshLogs,
} = useDashboardApi<UsageLogPage>("/usage", {
  query: computed(() => ({
    ...filterQuery.value,
    page: page.value,
    pageSize: DATA_TABLE_PAGE_SIZE,
  })),
});
const {
  data: summary,
  status: summaryStatus,
  refresh: refreshSummary,
} = useDashboardApi<UsageSummary>("/usage/totals", { query: filterQuery });

/**
 * Moves the window to end now, then reloads the logs and the totals. A moved
 * window starts both requests on its own; `defer` joins those instead of
 * repeating them, and still reloads when the window can't move ("All time").
 */
async function refresh(): Promise<void> {
  refreshTimeRange();
  await nextTick();
  await Promise.all([refreshLogs({ dedupe: "defer" }), refreshSummary({ dedupe: "defer" })]);
}

/** Only the first load shows placeholders; a refetch keeps the current rows until it lands. */
const isLoadingLogs = computed(() => usagePageStatus.value === "pending" && !usagePage.value);

const columns: DataTableColumn<UsageLogSummary>[] = [
  { id: "time", header: "Time", enableHiding: false },
  { id: "model", header: "Model" },
  { id: "apiKey", header: "API Key" },
  { id: "status", header: "Status" },
  { id: "inputTokens", header: "Input" },
  { id: "outputTokens", header: "Output" },
  { id: "cacheReadTokens", header: "Cache read" },
  { id: "cacheWriteTokens", header: "Cache write" },
  { id: "cost", header: "Cost" },
  { id: "timeToFirstToken", header: "First token" },
  { id: "duration", header: "Duration" },
  { id: "attempts", header: "Attempts" },
];

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
    />

    <UsageSummaryBand :summary="summary" :is-loading="summaryStatus === 'pending'" />

    <DataTable
      table-id="usage"
      label="Usage Logs"
      search-placeholder="Search model, key, error or ID"
      :columns="columns"
      :rows="usagePage?.items ?? []"
      :row-count="usagePage?.total ?? 0"
      :get-row-id="(log) => log.id"
      :is-loading="isLoadingLogs"
      :error="loadError"
      :refresh="refresh"
      :filters="activeFilters"
      @clear-filters="clearFilters"
    >
      <template #controls>
        <AppSelect
          :model-value="timeRange"
          :options="timeRangeOptions"
          label="Time range"
          @update:model-value="pickTimeRange"
        />
      </template>
      <template #filters>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Model</span>
          <AppMultiSelect
            v-model="modelFilter"
            :options="modelOptions"
            label="Filter by Model"
            placeholder="All Models"
            noun="Models"
          />
        </div>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">API Key</span>
          <AppMultiSelect
            v-model="apiKeyFilter"
            :options="apiKeyOptions"
            label="Filter by API Key"
            placeholder="All API Keys"
            noun="API Keys"
          />
        </div>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Status</span>
          <AppMultiSelect
            v-model="statusFilter"
            :options="statusOptions"
            label="Filter by status"
            placeholder="Any status"
            noun="statuses"
          />
        </div>
      </template>
      <template #cell-time="{ row: log }">
        <span class="tabular">{{ dateTimeFormat.format(new Date(log.createdAt)) }}</span>
      </template>
      <template #cell-model="{ row: log }">
        {{ log.modelName ?? (log.modelId ? "Deleted Model" : "—") }}
      </template>
      <template #cell-apiKey="{ row: log }">
        {{
          log.isPlayground
            ? "Playground"
            : (log.apiKeyName ?? (log.apiKeyId ? "Deleted API Key" : "—"))
        }}
      </template>
      <template #cell-status="{ row: log }">
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
      </template>
      <template #cell-inputTokens="{ row: log }">
        <span class="tabular">{{ formatCount(log.inputTokens) }}</span>
      </template>
      <template #cell-outputTokens="{ row: log }">
        <span class="tabular">{{ formatCount(log.outputTokens) }}</span>
      </template>
      <template #cell-cacheReadTokens="{ row: log }">
        <span class="tabular">{{ formatCount(log.cacheReadTokens) }}</span>
      </template>
      <template #cell-cacheWriteTokens="{ row: log }">
        <span class="tabular">{{ formatCount(log.cacheWriteTokens) }}</span>
      </template>
      <template #cell-cost="{ row: log }">
        <span class="tabular">{{ formatCost(log.cost) }}</span>
      </template>
      <template #cell-timeToFirstToken="{ row: log }">
        <span class="tabular">{{ formatDuration(log.timeToFirstTokenMs) }}</span>
      </template>
      <template #cell-duration="{ row: log }">
        <span class="tabular">{{ formatDuration(log.durationMs) }}</span>
      </template>
      <template #cell-attempts="{ row: log }">
        <span class="tabular">{{ log.attemptCount }}</span>
      </template>
      <template #empty>
        <EmptyState :icon="SearchX">
          <strong>No requests in this time range.</strong><span>Pick a wider time range.</span>
        </EmptyState>
      </template>
    </DataTable>
  </div>
</template>
