<script setup lang="ts">
import { SearchX } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';
import type { ApiKeySummary, ModelChoice } from '~/lib/api-keys';
import {
  formatCost,
  formatCount,
  formatDuration,
  hasErrorCaptures,
  isTimeRange,
  playgroundUserLabel,
  TIME_RANGES,
  type TimeRange,
  timeRangeStart,
  type UsageLogPage,
  type UsageLogSummary,
  USAGE_STATUS_BADGES,
  USAGE_STATUS_LABELS,
  usageStatusOf,
  type UsageSummary,
  USAGE_STATUSES,
} from '~/lib/usage';
import { type ActiveFilter, listFilterTokens } from '~/lib/activeFilters';
import { actionsColumn, DATA_TABLE_PAGE_SIZE, type DataTableColumn } from '~/lib/dataTable';
import { dateTimeFormat } from '~/lib/dateFormats';
import { ERROR_ORIGIN_LABELS, ERROR_ORIGINS } from '~/lib/errorOrigins';
import { SERVICE_TIER_LABELS, SERVICE_TIERS } from '~/lib/parameterPolicy';
import { isApiKeyChoice, isUuid, listParam, missingOptions, PLAYGROUND } from '~/lib/queryFilters';

useHead({ title: 'Usage' });

const timeRange = useQueryParam<TimeRange>('range', { default: '24h', isValid: isTimeRange });
const modelFilter = useQueryList('model', { isValid: isUuid });
const apiKeyFilter = useQueryList('key', { isValid: isApiKeyChoice, order: [PLAYGROUND] });
const statusFilter = useQueryList('status', {
  isValid: oneOf(USAGE_STATUSES),
  order: USAGE_STATUSES,
});
const errorOriginFilter = useQueryList('errorOrigin', {
  isValid: oneOf(ERROR_ORIGINS),
  order: ERROR_ORIGINS,
});
const serviceTierFilter = useQueryList('serviceTier', {
  isValid: oneOf(SERVICE_TIERS),
  order: SERVICE_TIERS,
});
const {
  integrationFilter,
  customerFilter,
  integrationOptions,
  ownerFilterTokens,
  clearOwnerFilters,
} = useOwnerFilters(() => usagePage.value?.items ?? []);
const search = useQuerySearch();
const page = useQueryPage();
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
  errorOriginFilter.value = [];
  serviceTierFilter.value = [];
  clearOwnerFilters();
}

watch(timeRange, () => {
  refreshTimeRange();
  page.value = 1;
});

const { data: modelChoices } = useDashboardApi<ModelChoice[]>('/api-keys/model-choices');
const { data: apiKeys } = useDashboardApi<ApiKeySummary[]>('/api-keys');

const timeRangeOptions = Object.entries(TIME_RANGES).map(([value, { label }]) => ({
  value,
  label,
}));
const modelOptions = computed(() => {
  const known = (modelChoices.value ?? []).map((model) => ({ value: model.id, label: model.name }));
  return [...known, ...missingOptions(modelFilter.value, known)];
});
const apiKeyOptions = computed(() => {
  const known = [
    { value: PLAYGROUND, label: 'Playground' },
    ...(apiKeys.value ?? []).map((apiKey) => ({ value: apiKey.id, label: apiKey.name })),
  ];
  return [...known, ...missingOptions(apiKeyFilter.value, known)];
});
const statusOptions = USAGE_STATUSES.map((value) => ({ value, label: USAGE_STATUS_LABELS[value] }));
const errorOriginOptions = ERROR_ORIGINS.map((value) => ({
  value,
  label: ERROR_ORIGIN_LABELS[value],
}));
const serviceTierOptions = SERVICE_TIERS.map((value) => ({
  value,
  label: SERVICE_TIER_LABELS[value],
}));

const activeFilters = computed<ActiveFilter[]>(() => [
  ...listFilterTokens('Model', modelFilter, modelOptions.value),
  ...listFilterTokens('API Key', apiKeyFilter, apiKeyOptions.value),
  ...listFilterTokens('Status', statusFilter, statusOptions),
  ...listFilterTokens('Error Origin', errorOriginFilter, errorOriginOptions),
  ...listFilterTokens('Tier', serviceTierFilter, serviceTierOptions),
  ...ownerFilterTokens.value,
]);

const filterQuery = computed(() => ({
  from: from.value,
  modelId: listParam(modelFilter.value),
  apiKeyId: listParam(apiKeyFilter.value.filter((value) => value !== PLAYGROUND)),
  isPlayground: apiKeyFilter.value.includes(PLAYGROUND) ? true : undefined,
  status: listParam(statusFilter.value),
  errorOrigin: listParam(errorOriginFilter.value),
  serviceTier: listParam(serviceTierFilter.value),
  integrationId: listParam(integrationFilter.value),
  customerId: customerFilter.value || undefined,
  q: search.value.trim() || undefined,
}));

const {
  data: usagePage,
  error: loadError,
  status: usagePageStatus,
  refresh: refreshLogs,
} = useDashboardApi<UsageLogPage>('/usage', {
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
} = useDashboardApi<UsageSummary>('/usage/totals', { query: filterQuery });

async function refresh(): Promise<void> {
  refreshTimeRange();
  await nextTick();
  await Promise.all([refreshLogs({ dedupe: 'defer' }), refreshSummary({ dedupe: 'defer' })]);
}

const isLoadingLogs = computed(() => usagePageStatus.value === 'pending' && !usagePage.value);

const columns: DataTableColumn<UsageLogSummary>[] = [
  { id: 'time', header: 'Time', enableHiding: false },
  { id: 'model', header: 'Model' },
  { id: 'apiKey', header: 'API Key' },
  { id: 'upstreamModel', header: 'Upstream Model' },
  { id: 'provider', header: 'Provider' },
  { id: 'integration', header: 'Integration' },
  { id: 'customer', header: 'Customer' },
  { id: 'status', header: 'Status' },
  { id: 'serviceTier', header: 'Tier' },
  { id: 'inputTokens', header: 'Input' },
  { id: 'outputTokens', header: 'Output' },
  { id: 'cacheReadTokens', header: 'Cache read' },
  { id: 'cacheWriteTokens', header: 'Cache write' },
  { id: 'cost', header: 'Cost' },
  { id: 'timeToFirstToken', header: 'Time to First Token' },
  { id: 'duration', header: 'Duration' },
  { id: 'attempts', header: 'Attempts' },
  actionsColumn(),
];
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Usage"
      description="One Usage Log per client request: tokens, Cost, latency and outcome."
    />

    <UsageSummaryBand :summary="summary" :is-loading="summaryStatus === 'pending'" />

    <section v-if="summary?.outputSpeedByUpstream.length" class="panel table-panel">
      <div class="panel-heading">
        <div>
          <h2>Output Speed by Upstream Model</h2>
          <p>Median and p5 Output Speed for each Upstream Model on each Provider Account.</p>
        </div>
      </div>
      <UsageOutputSpeedTable :speeds="summary.outputSpeedByUpstream" />
    </section>

    <DataTable
      table-id="usage"
      label="Usage Logs"
      search-placeholder="Search model, key, error, ID, user-agent or IP"
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
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Error Origin</span>
          <AppMultiSelect
            v-model="errorOriginFilter"
            :options="errorOriginOptions"
            label="Filter by Error Origin"
            placeholder="Any origin"
            noun="origins"
          />
        </div>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Tier</span>
          <AppMultiSelect
            v-model="serviceTierFilter"
            :options="serviceTierOptions"
            label="Filter by Service Tier"
            placeholder="Any tier"
            noun="tiers"
          />
        </div>
        <OwnerFilterFields
          v-model:integration-ids="integrationFilter"
          v-model:customer-id="customerFilter"
          :integration-options="integrationOptions"
        />
      </template>
      <template #cell-time="{ row: log }">
        <span class="tabular">{{ dateTimeFormat.format(new Date(log.createdAt)) }}</span>
      </template>
      <template #cell-model="{ row: log }">
        {{ log.modelName ?? (log.modelId ? 'Deleted Model' : '—') }}
      </template>
      <template #cell-apiKey="{ row: log }">
        <template v-if="log.isPlayground">
          Playground
          <span class="cell-note">{{ playgroundUserLabel(log) }}</span>
        </template>
        <template v-else>{{ log.apiKeyName ?? (log.apiKeyId ? 'Deleted API Key' : '—') }}</template>
      </template>
      <template #cell-upstreamModel="{ row: log }">{{ log.upstreamModelName ?? '—' }}</template>
      <template #cell-provider="{ row: log }">
        {{ log.providerName ?? log.providerSlug ?? '—' }}
        <span v-if="log.providerAccountName" class="cell-note">{{ log.providerAccountName }}</span>
      </template>
      <template #cell-integration="{ row: log }">{{ log.integrationName ?? '—' }}</template>
      <template #cell-customer="{ row: log }">{{ log.customerId ?? '—' }}</template>
      <template #cell-status="{ row: log }">
        <span class="status-badge" :class="USAGE_STATUS_BADGES[usageStatusOf(log)]">
          {{ USAGE_STATUS_LABELS[usageStatusOf(log)] }} · {{ log.errorCode ?? log.httpStatus }}
        </span>
        <span v-if="log.errorOrigin" class="status-badge status-badge--origin">
          {{ ERROR_ORIGIN_LABELS[log.errorOrigin] }} error
        </span>
        <span v-if="log.isIncomplete" class="cell-note">Incomplete usage</span>
        <NuxtLink
          v-if="hasErrorCaptures(log)"
          class="cell-note"
          :to="`/error-captures?usageLogId=${log.id}`"
          >Error Captures</NuxtLink
        >
      </template>
      <template #cell-serviceTier="{ row: log }">
        {{ log.serviceTier ? SERVICE_TIER_LABELS[log.serviceTier] : 'Default' }}
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
      <template #cell-actions="{ row: log }">
        <NuxtLink class="row-action" :to="`/usage/${log.id}`">View</NuxtLink>
      </template>
      <template #empty>
        <EmptyState :icon="SearchX">
          <strong>No requests in this time range.</strong><span>Pick a wider time range.</span>
        </EmptyState>
      </template>
    </DataTable>
  </div>
</template>
