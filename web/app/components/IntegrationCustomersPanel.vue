<script setup lang="ts">
import { UsersRound } from "@lucide/vue";
import { actionsColumn, DATA_TABLE_PAGE_SIZE, type DataTableColumn } from "~/lib/dataTable";
import { dateTimeFormat } from "~/lib/dateFormats";
import type { IntegrationCustomer, IntegrationCustomerPage } from "~/lib/integrations";
import { formatCost, formatCount } from "~/lib/usage";

/**
 * The Integration's Customers, rolled up over all time and paged by the
 * backend, most recently active first. The search matches the start of a
 * Customer id, case-sensitively.
 */
const props = defineProps<{ integrationId: string }>();

const search = useQuerySearch();
const page = useQueryPage();

const {
  data: customerPage,
  error: loadError,
  status,
  refresh,
} = useDashboardApi<IntegrationCustomerPage>(
  () => `/integrations/${props.integrationId}/customers`,
  {
    query: computed(() => ({
      page: page.value,
      pageSize: DATA_TABLE_PAGE_SIZE,
      search: search.value.trim() || undefined,
    })),
  },
);

const isLoading = computed(() => status.value === "pending" && !customerPage.value);

const columns: DataTableColumn<IntegrationCustomer>[] = [
  { id: "customer", header: "Customer", enableHiding: false },
  { id: "apiKeys", header: "API Keys" },
  { id: "spent", header: "Spent" },
  { id: "requests", header: "Requests" },
  { id: "cost", header: "Cost" },
  { id: "lastRequest", header: "Last request" },
  actionsColumn(),
];

/** A Customer's rows on another page, filtered to this Integration and that Customer. */
function ownerQuery(customer: IntegrationCustomer): Record<string, string> {
  return { integration: props.integrationId, customer: customer.customerId };
}
</script>

<template>
  <DataTable
    table-id="integration-customers"
    label="Customers"
    search-placeholder="Search Customer id (matches the start)"
    :columns="columns"
    :rows="customerPage?.items ?? []"
    :row-count="customerPage?.total ?? 0"
    :get-row-id="(customer) => customer.customerId"
    :is-loading="isLoading"
    :error="loadError"
    :refresh="refresh"
  >
    <template #cell-customer="{ row: customer }">
      <span class="tabular">{{ customer.customerId }}</span>
    </template>
    <template #cell-apiKeys="{ row: customer }">
      <span class="tabular">{{ formatCount(customer.activeKeyCount) }} active</span>
      <span v-if="customer.revokedKeyCount > 0" class="cell-note tabular"
        >{{ formatCount(customer.revokedKeyCount) }} revoked</span
      >
    </template>
    <template #cell-spent="{ row: customer }">
      <span class="tabular">{{ formatCost(customer.spent) }}</span>
    </template>
    <template #cell-requests="{ row: customer }">
      <span class="tabular">{{ formatCount(customer.requestCount) }}</span>
    </template>
    <template #cell-cost="{ row: customer }">
      <span class="tabular">{{ formatCost(customer.cost) }}</span>
    </template>
    <template #cell-lastRequest="{ row: customer }">
      <span v-if="customer.lastRequestAt" class="tabular">{{
        dateTimeFormat.format(new Date(customer.lastRequestAt))
      }}</span>
      <span v-else class="value-never">Never</span>
    </template>
    <template #cell-actions="{ row: customer }">
      <div class="row-actions">
        <NuxtLink class="row-action" :to="{ path: '/api-keys', query: ownerQuery(customer) }"
          >API Keys</NuxtLink
        >
        <NuxtLink
          class="row-action"
          :to="{ path: '/usage', query: { ...ownerQuery(customer), range: 'all' } }"
          >Usage</NuxtLink
        >
      </div>
    </template>
    <template #empty>
      <EmptyState :icon="UsersRound">
        <strong>No Customers yet.</strong
        ><span>A Customer appears once the Integration issues an API Key naming it.</span>
      </EmptyState>
    </template>
  </DataTable>
</template>
