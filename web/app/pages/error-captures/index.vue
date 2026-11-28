<script setup lang="ts">
import { SearchX, ShieldCheck } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';
import type { ApiKeySummary, ModelChoice } from '~/lib/api-keys';
import { type ActiveFilter, listFilterTokens } from '~/lib/activeFilters';
import { RECORDED_ATTEMPT_FAILURES } from '~/lib/attemptFailures';
import { actionsColumn, DATA_TABLE_PAGE_SIZE, type DataTableColumn } from '~/lib/dataTable';
import { dateTimeFormat } from '~/lib/dateFormats';
import {
  CAPTURE_OUTCOME_LABELS,
  CAPTURE_OUTCOMES,
  clientOutcome,
  FAILED_HOP_LABELS,
  FAILED_HOPS,
  failedHopLabel,
  failureReasonLabel,
  type ErrorCapturePage,
  type ErrorCaptureSummary,
} from '~/lib/errorCaptures';
import { ERROR_ORIGIN_LABELS, ERROR_ORIGINS } from '~/lib/errorOrigins';
import { isApiKeyChoice, isUuid, listParam, missingOptions, PLAYGROUND } from '~/lib/queryFilters';
import { modelOptionOf } from '~/lib/routing';
import type { ProviderAccount } from '~/lib/upstream';
import { isTimeRange, TIME_RANGES, type TimeRange, timeRangeStart } from '~/lib/usage';

useHead({ title: 'Error Captures' });

const route = useRoute();
const usageLogId = computed(() =>
  typeof route.query.usageLogId === 'string' ? route.query.usageLogId : undefined,
);

const timeRange = useQueryParam<TimeRange>('range', { default: 'all', isValid: isTimeRange });
const failedAtFilter = useQueryList('failedAt', {
  isValid: oneOf(FAILED_HOPS),
  order: FAILED_HOPS,
});
const providerAccountFilter = useQueryList('account', { isValid: isUuid });
const failureReasonFilter = useQueryList('failureReason', {
  isValid: oneOf(RECORDED_ATTEMPT_FAILURES),
  order: RECORDED_ATTEMPT_FAILURES,
});
const outcomeFilter = useQueryList('outcome', {
  isValid: oneOf(CAPTURE_OUTCOMES),
  order: CAPTURE_OUTCOMES,
});
const modelFilter = useQueryList('model', { isValid: isUuid });
const apiKeyFilter = useQueryList('key', { isValid: isApiKeyChoice, order: [PLAYGROUND] });
const errorOriginFilter = useQueryList('errorOrigin', {
  isValid: oneOf(ERROR_ORIGINS),
  order: ERROR_ORIGINS,
});
const {
  integrationFilter,
  customerFilter,
  integrationOptions,
  ownerFilterTokens,
  clearOwnerFilters,
} = useOwnerFilters(() => capturePage.value?.items ?? []);
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
  failedAtFilter.value = [];
  providerAccountFilter.value = [];
  failureReasonFilter.value = [];
  outcomeFilter.value = [];
  modelFilter.value = [];
  apiKeyFilter.value = [];
  errorOriginFilter.value = [];
  clearOwnerFilters();
}

watch(timeRange, () => {
  refreshTimeRange();
  page.value = 1;
});
watch(usageLogId, () => {
  page.value = 1;
});

const { data: providerAccounts } = useDashboardApi<ProviderAccount[]>('/provider-accounts');
const { data: modelChoices } = useDashboardApi<ModelChoice[]>('/api-keys/model-choices');
const { data: apiKeys } = useDashboardApi<ApiKeySummary[]>('/api-keys');

const timeRangeOptions = Object.entries(TIME_RANGES).map(([value, { label }]) => ({
  value,
  label,
}));
const failedAtOptions = FAILED_HOPS.map((value) => ({ value, label: FAILED_HOP_LABELS[value] }));
const providerAccountOptions = computed(() => {
  const known = (providerAccounts.value ?? []).map((account) => ({
    value: account.id,
    label: account.name,
  }));
  return [...known, ...missingOptions(providerAccountFilter.value, known)];
});
const failureReasonOptions = RECORDED_ATTEMPT_FAILURES.map((value) => ({
  value,
  label: failureReasonLabel(value),
}));
const outcomeOptions = CAPTURE_OUTCOMES.map((value) => ({
  value,
  label: CAPTURE_OUTCOME_LABELS[value],
}));
const modelOptions = computed(() => {
  const known = (modelChoices.value ?? []).map(modelOptionOf);
  return [...known, ...missingOptions(modelFilter.value, known)];
});
const apiKeyOptions = computed(() => {
  const known = [
    { value: PLAYGROUND, label: 'Playground' },
    ...(apiKeys.value ?? []).map((apiKey) => ({ value: apiKey.id, label: apiKey.name })),
  ];
  return [...known, ...missingOptions(apiKeyFilter.value, known)];
});
const errorOriginOptions = ERROR_ORIGINS.map((value) => ({
  value,
  label: ERROR_ORIGIN_LABELS[value],
}));

const activeFilters = computed<ActiveFilter[]>(() => [
  ...listFilterTokens('Failed at', failedAtFilter, failedAtOptions),
  ...listFilterTokens('Provider Account', providerAccountFilter, providerAccountOptions.value),
  ...listFilterTokens('Failure reason', failureReasonFilter, failureReasonOptions),
  ...listFilterTokens('Client got', outcomeFilter, outcomeOptions),
  ...listFilterTokens('Model', modelFilter, modelOptions.value),
  ...listFilterTokens('API Key', apiKeyFilter, apiKeyOptions.value),
  ...listFilterTokens('Error Origin', errorOriginFilter, errorOriginOptions),
  ...ownerFilterTokens.value,
]);

const isNarrowed = computed(
  () => activeFilters.value.length > 0 || search.value.trim() !== '' || timeRange.value !== 'all',
);

const {
  data: capturePage,
  status: captureStatus,
  error: loadError,
  refresh: refreshCaptures,
} = useDashboardApi<ErrorCapturePage>('/error-captures', {
  query: computed(() => ({
    usageLogId: usageLogId.value,
    from: from.value,
    failedAt: listParam(failedAtFilter.value),
    providerAccountId: listParam(providerAccountFilter.value),
    failureReason: listParam(failureReasonFilter.value),
    outcome: listParam(outcomeFilter.value),
    modelId: listParam(modelFilter.value),
    apiKeyId: listParam(apiKeyFilter.value.filter((value) => value !== PLAYGROUND)),
    isPlayground: apiKeyFilter.value.includes(PLAYGROUND) ? true : undefined,
    errorOrigin: listParam(errorOriginFilter.value),
    integrationId: listParam(integrationFilter.value),
    customerId: customerFilter.value || undefined,
    q: search.value.trim() || undefined,
    page: page.value,
    pageSize: DATA_TABLE_PAGE_SIZE,
  })),
});

async function refresh(): Promise<void> {
  refreshTimeRange();
  await nextTick();
  await refreshCaptures({ dedupe: 'defer' });
}

const isLoading = computed(() => captureStatus.value === 'pending' && !capturePage.value);

const columns: DataTableColumn<ErrorCaptureSummary>[] = [
  { id: 'time', header: 'Time', enableHiding: false },
  { id: 'failedAt', header: 'Failed at' },
  { id: 'model', header: 'Model' },
  { id: 'apiKey', header: 'API Key' },
  { id: 'integration', header: 'Integration' },
  { id: 'customer', header: 'Customer' },
  { id: 'clientGot', header: 'Client got' },
  actionsColumn(),
];
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Error Captures"
      description="Headers and bodies of failed requests and failed Attempts, credentials redacted. Deleted after the retention period."
    />

    <p v-if="usageLogId" class="filter-note">
      Showing the captures of one request.
      <NuxtLink to="/error-captures">Show all</NuxtLink>
    </p>

    <DataTable
      table-id="error-captures"
      label="Error Captures"
      search-placeholder="Search model, key, error, user-agent, IP or upstream request ID"
      :columns="columns"
      :rows="capturePage?.items ?? []"
      :row-count="capturePage?.total ?? 0"
      :get-row-id="(capture) => capture.id"
      :is-loading="isLoading"
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
          <span class="data-table-filter__label" aria-hidden="true">Failed at</span>
          <AppMultiSelect
            v-model="failedAtFilter"
            :options="failedAtOptions"
            label="Filter by where it failed"
            placeholder="Any hop"
            noun="hops"
          />
        </div>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Provider Account</span>
          <AppMultiSelect
            v-model="providerAccountFilter"
            :options="providerAccountOptions"
            label="Filter by Provider Account"
            placeholder="All Provider Accounts"
            noun="Provider Accounts"
          />
        </div>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Failure reason</span>
          <AppMultiSelect
            v-model="failureReasonFilter"
            :options="failureReasonOptions"
            label="Filter by failure reason"
            placeholder="Any reason"
            noun="reasons"
          />
        </div>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Client got</span>
          <AppMultiSelect
            v-model="outcomeFilter"
            :options="outcomeOptions"
            label="Filter by what the client got"
            placeholder="Any outcome"
            noun="outcomes"
          />
        </div>
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
          <span class="data-table-filter__label" aria-hidden="true">Error Origin</span>
          <AppMultiSelect
            v-model="errorOriginFilter"
            :options="errorOriginOptions"
            label="Filter by Error Origin"
            placeholder="Any origin"
            noun="origins"
          />
        </div>
        <OwnerFilterFields
          v-model:integration-ids="integrationFilter"
          v-model:customer-id="customerFilter"
          :integration-options="integrationOptions"
        />
      </template>
      <template #cell-time="{ row: capture }">
        <span class="tabular">{{ dateTimeFormat.format(new Date(capture.createdAt)) }}</span>
      </template>
      <template #cell-failedAt="{ row: capture }">
        <strong>{{ failedHopLabel(capture.failedHop) }}</strong>
      </template>
      <template #cell-model="{ row: capture }">{{ capture.modelName ?? '—' }}</template>
      <template #cell-apiKey="{ row: capture }">
        {{ capture.isPlayground ? 'Playground' : (capture.apiKeyName ?? '—') }}
      </template>
      <template #cell-integration="{ row: capture }">{{ capture.integrationName ?? '—' }}</template>
      <template #cell-customer="{ row: capture }">{{ capture.customerId ?? '—' }}</template>
      <template #cell-clientGot="{ row: capture }">
        <span :class="['status-badge', clientOutcome(capture).badgeClass]">{{
          clientOutcome(capture).label
        }}</span>
      </template>
      <template #cell-actions="{ row: capture }">
        <NuxtLink class="row-action" :to="`/error-captures/${capture.id}`">View</NuxtLink>
      </template>
      <template #empty>
        <EmptyState v-if="isNarrowed" :icon="SearchX">
          <strong>No Error Captures match.</strong
          ><span>Clear the filters or the search, or pick a wider time range.</span>
        </EmptyState>
        <EmptyState v-else :icon="ShieldCheck">
          <strong>No Error Captures.</strong
          ><span
            >Failed requests with a valid API Key are captured here. Successful requests and
            requests without a valid key never are.</span
          >
        </EmptyState>
      </template>
    </DataTable>
  </div>
</template>
