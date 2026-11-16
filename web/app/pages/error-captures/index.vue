<script setup lang="ts">
import { ShieldCheck } from "@lucide/vue";
import { actionsColumn, DATA_TABLE_PAGE_SIZE, type DataTableColumn } from "~/lib/dataTable";
import { dateTimeFormat } from "~/lib/dateFormats";
import {
  clientOutcome,
  failedHopLabel,
  type ErrorCapturePage,
  type ErrorCaptureSummary,
} from "~/lib/errorCaptures";

useHead({ title: "Error Captures" });

const route = useRoute();
/** Set when a Usage Log links here: only that request's captures, within which the search still applies. */
const usageLogId = computed(() =>
  typeof route.query.usageLogId === "string" ? route.query.usageLogId : undefined,
);
// The DataTable holds the search (?q=) and page (?page=) in the URL; this page reads them for its request.
const search = useQuerySearch();
const page = useQueryPage();
watch(usageLogId, () => {
  page.value = 1;
});

const {
  data: capturePage,
  status: captureStatus,
  error: loadError,
  refresh,
} = useDashboardApi<ErrorCapturePage>("/error-captures", {
  query: computed(() => ({
    usageLogId: usageLogId.value,
    q: search.value.trim() || undefined,
    page: page.value,
    pageSize: DATA_TABLE_PAGE_SIZE,
  })),
});

/** Placeholder rows only while there is nothing to show yet. */
const isLoading = computed(() => captureStatus.value === "pending" && !capturePage.value);

const columns: DataTableColumn<ErrorCaptureSummary>[] = [
  { id: "time", header: "Time", enableHiding: false },
  { id: "failedAt", header: "Failed at" },
  { id: "model", header: "Model" },
  { id: "apiKey", header: "API Key" },
  { id: "clientGot", header: "Client got" },
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
      search-placeholder="Search model, API key or error code"
      :columns="columns"
      :rows="capturePage?.items ?? []"
      :row-count="capturePage?.total ?? 0"
      :get-row-id="(capture) => capture.id"
      :is-loading="isLoading"
      :error="loadError"
      :refresh="refresh"
    >
      <template #cell-time="{ row: capture }">
        <span class="tabular">{{ dateTimeFormat.format(new Date(capture.createdAt)) }}</span>
      </template>
      <template #cell-failedAt="{ row: capture }">
        <strong>{{ failedHopLabel(capture.failedHop) }}</strong>
      </template>
      <template #cell-model="{ row: capture }">{{ capture.modelName ?? "—" }}</template>
      <template #cell-apiKey="{ row: capture }">
        {{ capture.isPlayground ? "Playground" : (capture.apiKeyName ?? "—") }}
      </template>
      <template #cell-clientGot="{ row: capture }">
        <span :class="['status-badge', clientOutcome(capture).badgeClass]">{{
          clientOutcome(capture).label
        }}</span>
      </template>
      <template #cell-actions="{ row: capture }">
        <NuxtLink class="row-action" :to="`/error-captures/${capture.id}`">View</NuxtLink>
      </template>
      <template #empty>
        <EmptyState :icon="ShieldCheck">
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
