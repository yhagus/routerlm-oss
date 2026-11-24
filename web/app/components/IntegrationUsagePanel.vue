<script setup lang="ts">
import { ArrowRight, SearchX } from "@lucide/vue";
import { actionsColumn, type DataTableColumn } from "~/lib/dataTable";
import { dateTimeFormat } from "~/lib/dateFormats";
import { ERROR_ORIGIN_LABELS } from "~/lib/errorOrigins";
import { SERVICE_TIER_LABELS } from "~/lib/parameterPolicy";
import {
  formatCost,
  formatCount,
  formatDuration,
  hasErrorCaptures,
  type UsageLogPage,
  type UsageLogSummary,
  USAGE_STATUS_BADGES,
  USAGE_STATUS_LABELS,
  usageStatusOf,
} from "~/lib/usage";

const props = defineProps<{ integrationId: string }>();

const NEWEST_LOG_COUNT = 20;

const {
  data: usagePage,
  error: loadError,
  status,
  refresh,
} = useDashboardApi<UsageLogPage>("/usage", {
  query: computed(() => ({ integrationId: props.integrationId, pageSize: NEWEST_LOG_COUNT })),
});

const isLoading = computed(() => status.value === "pending" && !usagePage.value);

const columns: DataTableColumn<UsageLogSummary>[] = [
  { id: "time", header: "Time", enableHiding: false },
  { id: "model", header: "Model", accessorFn: (log) => log.modelName ?? "" },
  { id: "apiKey", header: "API Key", accessorFn: (log) => log.apiKeyName ?? "" },
  { id: "customer", header: "Customer", accessorFn: (log) => log.customerId ?? "" },
  { id: "status", header: "Status" },
  { id: "serviceTier", header: "Tier" },
  { id: "inputTokens", header: "Input" },
  { id: "outputTokens", header: "Output" },
  { id: "cacheReadTokens", header: "Cache read" },
  { id: "cacheWriteTokens", header: "Cache write" },
  { id: "cost", header: "Cost" },
  { id: "timeToFirstToken", header: "First token" },
  { id: "duration", header: "Duration" },
  { id: "attempts", header: "Attempts" },
  actionsColumn(),
];
</script>

<template>
  <DataTable
    table-id="integration-usage"
    label="Usage Logs"
    search-placeholder="Search Model, API Key or Customer"
    :columns="columns"
    :rows="usagePage?.items ?? []"
    :get-row-id="(log) => log.id"
    :is-loading="isLoading"
    :error="loadError"
    :refresh="refresh"
    :count-label="`Newest ${NEWEST_LOG_COUNT}`"
  >
    <template #controls>
      <NuxtLink
        class="button button--quiet"
        :to="{ path: '/usage', query: { integration: integrationId, range: 'all' } }"
      >
        View all in Usage <ArrowRight :size="14" />
      </NuxtLink>
    </template>
    <template #cell-time="{ row: log }">
      <span class="tabular">{{ dateTimeFormat.format(new Date(log.createdAt)) }}</span>
    </template>
    <template #cell-model="{ row: log }">
      {{ log.modelName ?? (log.modelId ? "Deleted Model" : "—") }}
    </template>
    <template #cell-apiKey="{ row: log }">
      {{ log.apiKeyName ?? (log.apiKeyId ? "Deleted API Key" : "—") }}
    </template>
    <template #cell-customer="{ row: log }">{{ log.customerId ?? "—" }}</template>
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
      {{ log.serviceTier ? SERVICE_TIER_LABELS[log.serviceTier] : "Default" }}
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
        <strong>No requests yet.</strong
        ><span>Usage Logs appear once the Integration's Customers send requests.</span>
      </EmptyState>
    </template>
  </DataTable>
</template>
