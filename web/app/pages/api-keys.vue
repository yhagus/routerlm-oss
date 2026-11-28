<script setup lang="ts">
import { Ban, Copy, KeyRound, Pencil, Plus, RefreshCw } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { RowAction } from '~/components/RowActionsMenu.vue';
import { type ActiveFilter, listFilterTokens } from '~/lib/activeFilters';
import { apiErrorMessage } from '~/lib/api';
import {
  allowedAccessLabel,
  API_KEY_CONFIRM_COPY,
  API_KEY_STATUS_LABELS,
  type ApiKeyStatus,
  type ApiKeySummary,
  apiKeyStatus,
  type CreatedApiKey,
  isIntegrationOwned,
  type ModelChoice,
  requestRateLabel,
  spendLimitLabel,
} from '~/lib/api-keys';
import { concurrencyLimitLabel } from '~/lib/concurrencyLimit';
import { actionsColumn, type DataTableColumn } from '~/lib/dataTable';
import { dateFormat } from '~/lib/dateFormats';

useHead({ title: 'API Keys' });

const API_KEY_STATUSES = ['active', 'expired', 'revoked'] as const satisfies ApiKeyStatus[];
const statusFilterOptions = API_KEY_STATUSES.map((status) => ({
  label: API_KEY_STATUS_LABELS[status],
  value: status,
}));

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: apiKeys,
  error: loadError,
  status: apiKeysStatus,
  refresh,
} = useDashboardApi<ApiKeySummary[]>('/api-keys');
const { data: modelChoices, status: modelChoicesStatus } =
  useDashboardApi<ModelChoice[]>('/api-keys/model-choices');

const isLoadingApiKeys = computed(() => apiKeysStatus.value === 'pending' && !apiKeys.value);
const isLoadingModelChoices = computed(
  () => modelChoicesStatus.value === 'pending' && !modelChoices.value,
);

function formatDate(value: string | null, whenNull: string): string {
  return value ? dateFormat.format(new Date(value)) : whenNull;
}

interface ApiKeyRow extends ApiKeySummary {
  status: ApiKeyStatus;
}

const rows = computed<ApiKeyRow[]>(() =>
  (apiKeys.value ?? []).map((apiKey) => ({ ...apiKey, status: apiKeyStatus(apiKey, Date.now()) })),
);

const statusFilter = useQueryList('status', {
  isValid: oneOf(API_KEY_STATUSES),
  order: API_KEY_STATUSES,
});
const {
  integrationFilter,
  customerFilter,
  integrationOptions,
  ownerFilterTokens,
  clearOwnerFilters,
} = useOwnerFilters();

const activeFilters = computed<ActiveFilter[]>(() => [
  ...listFilterTokens('Status', statusFilter, statusFilterOptions),
  ...ownerFilterTokens.value,
]);

function matchesFilters(row: ApiKeyRow): boolean {
  const statuses = statusFilter.value;
  const integrationIds = integrationFilter.value;
  if (statuses.length > 0 && !statuses.includes(row.status)) return false;
  if (integrationIds.length > 0 && !integrationIds.includes(row.integration?.id ?? '')) {
    return false;
  }
  return customerFilter.value === '' || row.customerId === customerFilter.value;
}

const filteredRows = computed(() => rows.value.filter(matchesFilters));

function clearFilters(): void {
  statusFilter.value = [];
  clearOwnerFilters();
}

const columns: DataTableColumn<ApiKeyRow>[] = [
  { id: 'name', header: 'Name', enableHiding: false, accessorFn: (row) => row.name },
  { id: 'keyId', header: 'Key id', accessorFn: (row) => `rlm_${row.keyId}` },
  { id: 'integration', header: 'Integration', accessorFn: (row) => row.integration?.name ?? '' },
  { id: 'customer', header: 'Customer', accessorFn: (row) => row.customerId ?? '' },
  { id: 'allowedModels', header: 'Allowed Models', accessorFn: allowedAccessLabel },
  { id: 'spendLimit', header: 'Spend Limit' },
  { id: 'requestRate', header: 'Request Rate' },
  { id: 'concurrencyLimit', header: 'Concurrency Limit' },
  { id: 'created', header: 'Created' },
  { id: 'createdBy', header: 'Created by', accessorFn: (row) => row.createdBy?.email ?? '' },
  { id: 'expires', header: 'Expires' },
  { id: 'lastRotated', header: 'Last rotated' },
  { id: 'status', header: 'Status' },
  actionsColumn(),
];

const historyOf = ref<ApiKeySummary | null>(null);
const isHistoryOpen = computed({
  get: () => historyOf.value !== null,
  set: (isOpen) => {
    if (!isOpen) historyOf.value = null;
  },
});

const editing = ref<ApiKeySummary | undefined>(undefined);
const isFormOpen = ref(false);

function openCreateDialog(): void {
  editing.value = undefined;
  isFormOpen.value = true;
}

function openEditDialog(apiKey: ApiKeySummary): void {
  editing.value = apiKey;
  isFormOpen.value = true;
}

async function handleCreated(apiKey: CreatedApiKey): Promise<void> {
  isFormOpen.value = false;
  revealed.value = { apiKey, verb: 'created' };
  await refresh();
}

async function handleUpdated(apiKey: ApiKeySummary): Promise<void> {
  isFormOpen.value = false;
  showToast(`Saved ${apiKey.name}`);
  await refresh();
}

const revealed = ref<{ apiKey: CreatedApiKey; verb: 'created' | 'rotated' } | null>(null);
const isRevealOpen = computed({
  get: () => revealed.value !== null,
  set: (isOpen) => {
    if (!isOpen) revealed.value = null;
  },
});

async function writeToClipboard(key: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(key);
    showToast(done);
  } catch {
    showToast("Couldn't copy. Select the key and copy it yourself.");
  }
}

function selectAll(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select();
}

async function copyApiKey(apiKey: ApiKeySummary): Promise<void> {
  try {
    const { key } = await $dashboardApi<{ key: string }>(`/api-keys/${apiKey.id}/key`);
    await writeToClipboard(key, `Copied ${apiKey.name}`);
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't copy ${apiKey.name}.`));
  }
}

type Confirmation = { kind: 'rotate' | 'revoke'; apiKey: ApiKeySummary };
const confirming = ref<Confirmation | null>(null);
const isConfirming = ref(false);
const confirmError = ref('');
const isConfirmOpen = computed({
  get: () => confirming.value !== null,
  set: (isOpen) => {
    if (!isOpen) confirming.value = null;
  },
});

async function confirmAction(): Promise<void> {
  const current = confirming.value;
  if (!current) return;
  isConfirming.value = true;
  confirmError.value = '';
  try {
    if (current.kind === 'rotate') {
      const rotated = await $dashboardApi<CreatedApiKey>(`/api-keys/${current.apiKey.id}/rotate`, {
        method: 'POST',
      });
      confirming.value = null;
      revealed.value = { apiKey: rotated, verb: 'rotated' };
    } else {
      await $dashboardApi(`/api-keys/${current.apiKey.id}/revoke`, { method: 'POST' });
      showToast(`Revoked ${current.apiKey.name}`);
      confirming.value = null;
    }
    await refresh();
  } catch (error) {
    confirmError.value = apiErrorMessage(error, API_KEY_CONFIRM_COPY[current.kind].failed);
  } finally {
    isConfirming.value = false;
  }
}

type ApiKeyActionId = 'copy' | 'edit' | 'rotate' | 'revoke';

const REVOKE_ACTION: RowAction<ApiKeyActionId> = {
  id: 'revoke',
  label: 'Revoke',
  icon: Ban,
  isDestructive: true,
};

function actionsFor(apiKey: ApiKeyRow): RowAction<ApiKeyActionId>[] {
  if (isIntegrationOwned(apiKey)) return [REVOKE_ACTION];
  return [
    {
      id: 'copy',
      label: 'Copy key',
      icon: Copy,
      isDisabled: !apiKey.isCopyable,
      hint: apiKey.isCopyable ? undefined : 'Made before keys were kept. Rotate it to copy.',
    },
    { id: 'edit', label: 'Edit', icon: Pencil },
    { id: 'rotate', label: 'Rotate key', icon: RefreshCw },
    REVOKE_ACTION,
  ];
}

function handleAction(apiKey: ApiKeyRow, id: ApiKeyActionId): void {
  if (id === 'copy') {
    void copyApiKey(apiKey);
  } else if (id === 'edit') {
    openEditDialog(apiKey);
  } else {
    confirmError.value = '';
    confirming.value = { kind: id, apiKey };
  }
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="API Keys"
      description="Credentials client applications use to call the gateway."
    >
      <button class="button button--primary" type="button" @click="openCreateDialog">
        <Plus :size="14" /> Create API Key
      </button>
    </PageHeading>

    <DataTable
      table-id="api-keys"
      label="API Keys"
      search-placeholder="Search name, key id, Integration, Customer, Model or creator"
      :columns="columns"
      :rows="filteredRows"
      :get-row-id="(row) => row.id"
      :row-class="(row) => ({ 'row--receded': row.status !== 'active' })"
      :is-loading="isLoadingApiKeys"
      :error="loadError"
      :refresh="refresh"
      :filters="activeFilters"
      @clear-filters="clearFilters"
    >
      <template #filters>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Status</span>
          <AppMultiSelect
            v-model="statusFilter"
            :options="statusFilterOptions"
            label="Filter by status"
            placeholder="Any status"
            noun="statuses"
          />
        </div>
        <OwnerFilterFields
          v-model:integration-ids="integrationFilter"
          v-model:customer-id="customerFilter"
          :integration-options="integrationOptions"
        />
      </template>
      <template #cell-name="{ row: apiKey }">
        <div class="table-entity">
          <span class="key-icon"><KeyRound :size="15" /></span><strong>{{ apiKey.name }}</strong
          ><span
            v-if="apiKey.directUpstreamAccess"
            class="status-badge"
            title="Can call Upstream Models directly as upstream/<provider>/<model>"
            >Upstream</span
          >
        </div>
      </template>
      <template #cell-keyId="{ row: apiKey }">
        <span class="tabular">rlm_{{ apiKey.keyId }}_…</span>
      </template>
      <template #cell-integration="{ row: apiKey }">{{ apiKey.integration?.name ?? '—' }}</template>
      <template #cell-customer="{ row: apiKey }">
        <span class="tabular">{{ apiKey.customerId ?? '—' }}</span>
      </template>
      <template #cell-spendLimit="{ row: apiKey }">
        <span class="tabular">{{ spendLimitLabel(apiKey) }}</span>
      </template>
      <template #cell-requestRate="{ row: apiKey }">
        <span class="tabular">{{ requestRateLabel(apiKey) }}</span>
      </template>
      <template #cell-concurrencyLimit="{ row: apiKey }">
        <span class="tabular">{{ concurrencyLimitLabel(apiKey.concurrencyLimit) }}</span>
      </template>
      <template #cell-allowedModels="{ row: apiKey }">
        <span class="models-summary" :title="allowedAccessLabel(apiKey)">{{
          allowedAccessLabel(apiKey)
        }}</span>
      </template>
      <template #cell-created="{ row: apiKey }">
        <span class="tabular">{{ formatDate(apiKey.createdAt, '—') }}</span>
      </template>
      <template #cell-createdBy="{ row: apiKey }">{{ apiKey.createdBy?.email ?? '—' }}</template>
      <template #cell-expires="{ row: apiKey }">
        <span class="tabular">{{ formatDate(apiKey.expiresAt, 'Never') }}</span>
      </template>
      <template #cell-lastRotated="{ row: apiKey }">
        <button
          v-if="apiKey.lastRotatedAt"
          class="api-key-rotated tabular"
          type="button"
          :aria-label="`Rotation history of ${apiKey.name}, last rotated ${formatDate(apiKey.lastRotatedAt, '')}`"
          @click="historyOf = apiKey"
        >
          {{ formatDate(apiKey.lastRotatedAt, '') }}
        </button>
        <span v-else class="value-never">Never</span>
      </template>
      <template #cell-status="{ row: apiKey }">
        <span
          class="status-badge"
          :class="apiKey.status === 'active' ? 'status-badge--good' : 'status-badge--bad'"
          >{{ API_KEY_STATUS_LABELS[apiKey.status] }}</span
        >
      </template>
      <template #cell-actions="{ row: apiKey }">
        <div class="row-actions">
          <RowActionsMenu
            v-if="apiKey.status !== 'revoked'"
            :label="`Actions for ${apiKey.name}`"
            :actions="actionsFor(apiKey)"
            @select="(id) => handleAction(apiKey, id)"
          />
        </div>
      </template>
      <template #empty>
        <EmptyState :icon="KeyRound">
          <strong>No API Keys yet.</strong
          ><span>Create one for each client application that calls the gateway.</span>
        </EmptyState>
      </template>
    </DataTable>

    <ApiKeyRotationsDialog v-if="historyOf" v-model:open="isHistoryOpen" :api-key="historyOf" />

    <ApiKeyFormDialog
      v-model:open="isFormOpen"
      :api-key="editing"
      :model-choices="modelChoices ?? undefined"
      :is-loading-model-choices="isLoadingModelChoices"
      @created="handleCreated"
      @updated="handleUpdated"
    />

    <AppDialog
      v-if="revealed"
      v-model:open="isRevealOpen"
      :title="`${revealed.apiKey.name} ${revealed.verb}`"
      :description="
        revealed.verb === 'rotated'
          ? 'Give this key to the clients that used the old one, which no longer works. You can copy it again later from the row menu.'
          : 'Give this key to the client application. You can copy it again later from the row menu.'
      "
    >
      <div class="key-reveal">
        <input
          class="text-input key-reveal__value tabular"
          type="text"
          :value="revealed.apiKey.key"
          aria-label="API Key"
          readonly
          @focus="selectAll"
        />
        <button
          class="button"
          type="button"
          @click="writeToClipboard(revealed.apiKey.key, 'API Key copied')"
        >
          <Copy :size="14" /> Copy
        </button>
      </div>
      <div class="dialog__actions">
        <button class="button button--primary" type="button" @click="revealed = null">Done</button>
      </div>
    </AppDialog>

    <AppDialog
      v-if="confirming"
      v-model:open="isConfirmOpen"
      :title="API_KEY_CONFIRM_COPY[confirming.kind].title"
      :description="API_KEY_CONFIRM_COPY[confirming.kind].description(confirming.apiKey.name)"
    >
      <p v-if="confirmError" class="form__error" role="alert">{{ confirmError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="confirming = null">Cancel</button>
        <button
          class="button"
          :class="confirming.kind === 'revoke' ? 'button--danger' : 'button--primary'"
          type="button"
          :disabled="isConfirming"
          @click="confirmAction"
        >
          {{ API_KEY_CONFIRM_COPY[confirming.kind].action }}
        </button>
      </div>
    </AppDialog>
  </div>
</template>
