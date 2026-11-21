<script setup lang="ts">
import { ArrowRight, Ban, KeyRound } from "@lucide/vue";
import type { RowAction } from "~/components/RowActionsMenu.vue";
import { apiErrorMessage } from "~/lib/api";
import {
  API_KEY_CONFIRM_COPY,
  API_KEY_STATUS_LABELS,
  type ApiKeyStatus,
  type ApiKeySummary,
  apiKeyStatus,
  requestRateLabel,
  spendLimitLabel,
} from "~/lib/api-keys";
import { actionsColumn, type DataTableColumn } from "~/lib/dataTable";
import { dateFormat } from "~/lib/dateFormats";

/**
 * Every API Key the Integration issued to its Customers. They belong to what
 * the Integration sold, so the only thing the dashboard does with one is revoke it.
 */
const props = defineProps<{ integrationId: string }>();
const emit = defineEmits<{ revoked: [] }>();

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: apiKeys,
  error: loadError,
  status,
  refresh,
} = useDashboardApi<ApiKeySummary[]>("/api-keys", {
  query: computed(() => ({ integrationId: props.integrationId })),
});

const isLoading = computed(() => status.value === "pending" && !apiKeys.value);

interface ApiKeyRow extends ApiKeySummary {
  status: ApiKeyStatus;
}

// Status is worked out once per load, as on the API Keys page.
const rows = computed<ApiKeyRow[]>(() =>
  (apiKeys.value ?? []).map((apiKey) => ({ ...apiKey, status: apiKeyStatus(apiKey, Date.now()) })),
);

const columns: DataTableColumn<ApiKeyRow>[] = [
  { id: "name", header: "Name", enableHiding: false, accessorFn: (row) => row.name },
  { id: "customer", header: "Customer", accessorFn: (row) => row.customerId ?? "" },
  { id: "keyId", header: "Key id", accessorFn: (row) => `rlm_${row.keyId}` },
  { id: "spendLimit", header: "Spend Limit" },
  { id: "requestRate", header: "Request Rate" },
  { id: "expires", header: "Expires" },
  { id: "status", header: "Status", accessorFn: (row) => API_KEY_STATUS_LABELS[row.status] },
  { id: "created", header: "Created" },
  actionsColumn(),
];

function formatDate(value: string | null, whenNull: string): string {
  return value ? dateFormat.format(new Date(value)) : whenNull;
}

const REVOKE_ACTIONS: RowAction<"revoke">[] = [
  { id: "revoke", label: "Revoke", icon: Ban, isDestructive: true },
];

const revoking = ref<ApiKeySummary | null>(null);
const isRevoking = ref(false);
const revokeError = ref("");
const isRevokeOpen = computed({
  get: () => revoking.value !== null,
  set: (open) => {
    if (!open) revoking.value = null;
  },
});

function openRevoke(apiKey: ApiKeySummary): void {
  revokeError.value = "";
  revoking.value = apiKey;
}

async function revoke(): Promise<void> {
  const apiKey = revoking.value;
  if (!apiKey) return;
  isRevoking.value = true;
  revokeError.value = "";
  try {
    await $dashboardApi(`/api-keys/${apiKey.id}/revoke`, { method: "POST" });
    showToast(`Revoked ${apiKey.name}`);
    revoking.value = null;
    emit("revoked");
    await refresh();
  } catch (error) {
    revokeError.value = apiErrorMessage(error, API_KEY_CONFIRM_COPY.revoke.failed);
  } finally {
    isRevoking.value = false;
  }
}
</script>

<template>
  <DataTable
    table-id="integration-api-keys"
    label="API Keys"
    search-placeholder="Search name, Customer or key id"
    :columns="columns"
    :rows="rows"
    :get-row-id="(row) => row.id"
    :row-class="(row) => ({ 'row--receded': row.status !== 'active' })"
    :is-loading="isLoading"
    :error="loadError"
    :refresh="refresh"
  >
    <template #controls>
      <NuxtLink class="button button--quiet" :to="`/api-keys?integration=${integrationId}`">
        View in API Keys <ArrowRight :size="14" />
      </NuxtLink>
    </template>
    <template #cell-name="{ row: apiKey }">
      <div class="table-entity">
        <span class="key-icon"><KeyRound :size="15" /></span><strong>{{ apiKey.name }}</strong>
      </div>
    </template>
    <template #cell-customer="{ row: apiKey }">
      <span class="tabular">{{ apiKey.customerId ?? "—" }}</span>
    </template>
    <template #cell-keyId="{ row: apiKey }">
      <span class="tabular">rlm_{{ apiKey.keyId }}_…</span>
    </template>
    <template #cell-spendLimit="{ row: apiKey }">
      <span class="tabular">{{ spendLimitLabel(apiKey) }}</span>
    </template>
    <template #cell-requestRate="{ row: apiKey }">
      <span class="tabular">{{ requestRateLabel(apiKey) }}</span>
    </template>
    <template #cell-expires="{ row: apiKey }">
      <span class="tabular">{{ formatDate(apiKey.expiresAt, "Never") }}</span>
    </template>
    <template #cell-status="{ row: apiKey }">
      <span
        class="status-badge"
        :class="apiKey.status === 'active' ? 'status-badge--good' : 'status-badge--bad'"
        >{{ API_KEY_STATUS_LABELS[apiKey.status] }}</span
      >
    </template>
    <template #cell-created="{ row: apiKey }">
      <span class="tabular">{{ formatDate(apiKey.createdAt, "—") }}</span>
    </template>
    <template #cell-actions="{ row: apiKey }">
      <div class="row-actions">
        <RowActionsMenu
          v-if="apiKey.status !== 'revoked'"
          :label="`Actions for ${apiKey.name}`"
          :actions="REVOKE_ACTIONS"
          @select="openRevoke(apiKey)"
        />
      </div>
    </template>
    <template #empty>
      <EmptyState :icon="KeyRound">
        <strong>No API Keys yet.</strong
        ><span>The Integration issues them to its Customers through the control plane.</span>
      </EmptyState>
    </template>
  </DataTable>

  <AppDialog
    v-if="revoking"
    v-model:open="isRevokeOpen"
    :title="API_KEY_CONFIRM_COPY.revoke.title"
    :description="API_KEY_CONFIRM_COPY.revoke.description(revoking.name)"
  >
    <p v-if="revokeError" class="form__error" role="alert">{{ revokeError }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="revoking = null">Cancel</button>
      <button class="button button--danger" type="button" :disabled="isRevoking" @click="revoke">
        {{ API_KEY_CONFIRM_COPY.revoke.action }}
      </button>
    </div>
  </AppDialog>
</template>
