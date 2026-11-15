<script setup lang="ts">
import { ChevronRight, CircleAlert, Pencil, Plug, Plus, Power, Trash2 } from "@lucide/vue";
import { computed, h, ref } from "vue";
import {
  baseUrlHost,
  providerStats,
  type ProviderStats,
  unroutableReason,
  unroutableShort,
} from "~/lib/providerOverview";
import {
  type Provider,
  type ProviderAccount,
  type UpstreamModel,
  PROTOCOL_LABELS,
  PROTOCOL_OPTIONS,
  UPSTREAM_PROTOCOLS,
} from "~/lib/upstream";
import { type ActiveFilter, listFilterTokens } from "~/lib/activeFilters";
import type { DataTableColumn } from "~/lib/dataTable";

useHead({ title: "Providers" });

type ProviderDialog =
  | { kind: "create" }
  | { kind: "edit"; provider: Provider }
  | { kind: "delete"; provider: Provider };

const {
  data: providers,
  status: providersStatus,
  error: loadError,
  refresh: refreshProviders,
} = useDashboardApi<Provider[]>("/providers");
const {
  data: accounts,
  status: accountsStatus,
  error: accountsError,
  refresh: refreshAccounts,
} = useDashboardApi<ProviderAccount[]>("/provider-accounts");
const {
  data: models,
  status: modelsStatus,
  error: modelsError,
  refresh: refreshModels,
} = useDashboardApi<UpstreamModel[]>("/upstream-models");

const isLoadingProviders = computed(() => providersStatus.value === "pending" && !providers.value);

/** Cooldowns are judged as of the last load. */
const loadedAt = ref(Date.now());

/** Deleting a Provider deletes its accounts and models, so every list reloads. */
async function refresh(): Promise<void> {
  await Promise.all([refreshProviders(), refreshAccounts(), refreshModels()]);
  loadedAt.value = Date.now();
}

const isLoadingStats = computed(
  () =>
    (accountsStatus.value === "pending" && !accounts.value) ||
    (modelsStatus.value === "pending" && !models.value),
);
/** Row stats need both lists; without them a row shows its configuration only. */
const hasStatsError = computed(() => Boolean(accountsError.value || modelsError.value));
const hasStats = computed(() => !isLoadingStats.value && !hasStatsError.value);

interface ProviderRow {
  provider: Provider;
  stats: ProviderStats;
}

const rows = computed<ProviderRow[]>(() =>
  (providers.value ?? []).map((provider) => ({
    provider,
    stats: providerStats(provider, accounts.value ?? [], models.value ?? [], loadedAt.value),
  })),
);

const summary = computed(() => {
  const all = rows.value;
  const sum = (pick: (stats: ProviderStats) => number) =>
    all.reduce((total, row) => total + pick(row.stats), 0);
  return {
    providers: all.length,
    enabled: all.filter((row) => row.provider.isEnabled).length,
    unroutable: all.filter((row) => row.stats.isUnroutable).length,
    accounts: sum((stats) => stats.accounts.total),
    readyAccounts: sum((stats) => stats.accounts.ready),
    coolingAccounts: sum((stats) => stats.accounts.cooldown),
    models: sum((stats) => stats.models.total),
    enabledModels: sum((stats) => stats.models.enabled),
  };
});

// Held in the URL (?protocol=…&status=…) so a refresh or a link keeps them. The
// DataTable holds the search and page the same way.
const PROVIDER_STATUSES = ["enabled", "disabled", "attention"] as const;
type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
const protocolFilter = useQueryList("protocol", {
  isValid: oneOf(UPSTREAM_PROTOCOLS),
  order: UPSTREAM_PROTOCOLS,
});
const statusFilter = useQueryList("status", {
  isValid: oneOf(PROVIDER_STATUSES),
  order: PROVIDER_STATUSES,
});
const statusFilterOptions = [
  { label: "Enabled", value: "enabled" },
  { label: "Disabled", value: "disabled" },
  { label: "Needs attention", value: "attention" },
] satisfies { label: string; value: ProviderStatus }[];

/** Whether a row is in `status`; "attention" overlaps the other two. */
function hasStatus(provider: Provider, stats: ProviderStats, status: ProviderStatus): boolean {
  if (status === "enabled") return provider.isEnabled;
  if (status === "disabled") return !provider.isEnabled;
  return stats.isUnroutable;
}

const activeFilters = computed<ActiveFilter[]>(() => [
  ...listFilterTokens("Protocol", protocolFilter, PROTOCOL_OPTIONS),
  ...listFilterTokens("Status", statusFilter, statusFilterOptions),
]);

/** Rows the Protocol and status filters keep; the DataTable applies the search. */
const filteredRows = computed(() =>
  rows.value.filter(({ provider, stats }) => {
    if (protocolFilter.value.length && !protocolFilter.value.includes(provider.protocol)) {
      return false;
    }
    return (
      statusFilter.value.length === 0 ||
      statusFilter.value.some((status) => hasStatus(provider, stats, status))
    );
  }),
);

function clearFilters(): void {
  protocolFilter.value = [];
  statusFilter.value = [];
}

const columns: DataTableColumn<ProviderRow>[] = [
  {
    id: "provider",
    header: "Provider",
    enableHiding: false,
    // What the search matches: name, slug or base URL.
    accessorFn: ({ provider }) => [provider.name, provider.slug, provider.baseUrl].join("\n"),
  },
  { id: "protocol", header: "Protocol" },
  { id: "status", header: "Status" },
  { id: "accounts", header: "Accounts" },
  { id: "models", header: "Models" },
  { id: "actions", header: () => h("span", { class: "sr-only" }, "Actions"), enableHiding: false },
];

function accountSegments(stats: ProviderStats) {
  return [
    { key: "ready", name: "Ready", value: stats.accounts.ready },
    { key: "cooldown", name: "Cooling down", value: stats.accounts.cooldown },
    { key: "disabled", name: "Disabled", value: stats.accounts.disabled },
  ].filter((segment) => segment.value > 0);
}

function detailPath(provider: Provider, tab?: "accounts" | "models"): string {
  const path = `/providers/${provider.id}`;
  return tab ? `${path}?tab=${tab}` : path;
}

const {
  dialog,
  isDialogOpen,
  isSaving,
  dialogError,
  showDialog,
  closeDialog,
  deleteRow,
  toggleRow,
} = useEditableList<ProviderDialog>("/providers", refresh);

const isFormOpen = computed({
  get: () => dialog.value !== null && dialog.value.kind !== "delete",
  set: (open) => {
    if (!open) closeDialog();
  },
});
const editedProvider = computed(() =>
  dialog.value?.kind === "edit" ? dialog.value.provider : undefined,
);

function deleteProvider(provider: Provider): Promise<void> {
  return deleteRow(provider, provider.name, "Couldn't delete the Provider.");
}

function toggleProvider(provider: Provider): Promise<void> {
  return toggleRow(provider, provider.name);
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Providers"
      description="The upstream services the gateway calls, from the Catalog or added by hand. Any Provider that speaks a known Protocol can be added here."
    >
      <button class="button button--primary" type="button" @click="showDialog({ kind: 'create' })">
        <Plus :size="14" /> Add Provider
      </button>
    </PageHeading>

    <section
      v-if="isLoadingProviders || summary.providers > 0"
      class="executive-band executive-band--providers"
      :aria-busy="isLoadingProviders || isLoadingStats"
    >
      <div class="executive-band__lead">
        <span class="metric-label">Enabled Providers</span>
        <strong v-if="isLoadingProviders"><AppSpinner label="" /></strong>
        <template v-else>
          <strong class="tabular">{{ summary.enabled }}</strong
          ><span class="executive-band__of tabular">of {{ summary.providers }}</span>
        </template>
        <p v-if="hasStats && summary.unroutable > 0" class="executive-band__alert">
          <CircleAlert :size="13" /> {{ summary.unroutable }} can't take traffic yet
        </p>
        <p v-else-if="hasStats && !isLoadingProviders">
          Every enabled Provider has a ready key and a model.
        </p>
      </div>
      <div class="executive-band__stat">
        <span>Ready accounts</span>
        <strong v-if="isLoadingProviders || isLoadingStats"><AppSpinner label="" /></strong>
        <template v-else>
          <strong class="tabular">{{ hasStats ? summary.readyAccounts : "—" }}</strong>
          <small class="tabular">of {{ hasStats ? summary.accounts : "—" }} keys</small>
        </template>
      </div>
      <div class="executive-band__stat">
        <span>Cooling down</span>
        <strong v-if="isLoadingProviders || isLoadingStats"><AppSpinner label="" /></strong>
        <template v-else>
          <strong class="tabular">{{ hasStats ? summary.coolingAccounts : "—" }}</strong>
          <small>keys resting after errors</small>
        </template>
      </div>
      <div class="executive-band__stat">
        <span>Enabled models</span>
        <strong v-if="isLoadingProviders || isLoadingStats"><AppSpinner label="" /></strong>
        <template v-else>
          <strong class="tabular">{{ hasStats ? summary.enabledModels : "—" }}</strong>
          <small class="tabular">of {{ hasStats ? summary.models : "—" }} Upstream Models</small>
        </template>
      </div>
    </section>

    <p v-if="hasStatsError && !loadError" class="form__hint provider-stats-note">
      Couldn't load Provider Accounts or Upstream Models, so the table shows configuration only.
    </p>

    <DataTable
      class="provider-table"
      table-id="providers"
      label="Providers"
      search-placeholder="Search name, slug or URL"
      :columns="columns"
      :rows="filteredRows"
      :get-row-id="(row) => row.provider.id"
      :row-class="(row) => ({ 'provider-table__row--off': !row.provider.isEnabled })"
      :is-loading="isLoadingProviders"
      :error="loadError"
      :refresh="refresh"
      :filters="activeFilters"
      @clear-filters="clearFilters"
    >
      <template #filters>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Protocol</span>
          <AppMultiSelect
            v-model="protocolFilter"
            :options="PROTOCOL_OPTIONS"
            label="Filter by Protocol"
            placeholder="All Protocols"
            noun="Protocols"
          />
        </div>
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
      </template>
      <template #cell-provider="{ row: { provider } }">
        <NuxtLink class="table-entity provider-table__entity" :to="detailPath(provider)">
          <ProviderLogo :slug="provider.slug" :name="provider.name" :base-url="provider.baseUrl" />
          <span class="provider-table__name">
            <strong :title="provider.name"
              >{{ provider.name }}<ChevronRight :size="13" aria-hidden="true"
            /></strong>
            <span class="cell-note" :title="provider.baseUrl"
              >{{ provider.slug }} · {{ baseUrlHost(provider.baseUrl) }}</span
            >
          </span>
        </NuxtLink>
      </template>
      <template #cell-protocol="{ row: { provider } }">
        {{ PROTOCOL_LABELS[provider.protocol] }}
        <span class="cell-note"
          >{{ provider.authStyle
          }}<template v-if="provider.isFromCatalog"> · Catalog</template></span
        >
      </template>
      <template #cell-status="{ row: { provider, stats } }">
        <span
          class="status-badge"
          :class="provider.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
          >{{ provider.isEnabled ? "Enabled" : "Disabled" }}</span
        >
        <span
          v-if="hasStats && stats.isUnroutable"
          class="provider-table__alert"
          :title="unroutableReason(stats)"
          ><CircleAlert :size="12" />{{ unroutableShort(stats) }}</span
        >
      </template>
      <template #cell-accounts="{ row: { provider, stats } }">
        <template v-if="hasStats">
          <NuxtLink class="provider-table__count tabular" :to="detailPath(provider, 'accounts')"
            >{{ stats.accounts.ready }}<small> / {{ stats.accounts.total }} ready</small></NuxtLink
          >
          <div
            class="account-bar"
            role="img"
            :aria-label="`Provider Accounts: ${stats.accounts.ready} ready, ${stats.accounts.cooldown} cooling down, ${stats.accounts.disabled} disabled`"
          >
            <span
              v-for="segment in accountSegments(stats)"
              :key="segment.key"
              class="account-bar__part"
              :class="`account-bar__part--${segment.key}`"
              :style="{ flexGrow: segment.value }"
              :title="`${segment.value} ${segment.name.toLowerCase()}`"
            />
          </div>
        </template>
        <template v-else>—</template>
      </template>
      <template #cell-models="{ row: { provider, stats } }">
        <NuxtLink
          v-if="hasStats"
          class="provider-table__count tabular"
          :to="detailPath(provider, 'models')"
          >{{ stats.models.enabled }}<small> / {{ stats.models.total }} on</small></NuxtLink
        >
        <template v-else>—</template>
      </template>
      <template #cell-actions="{ row: { provider } }">
        <div class="row-actions provider-table__actions">
          <button
            class="icon-action"
            type="button"
            :aria-label="`Edit ${provider.name}`"
            title="Edit"
            @click="showDialog({ kind: 'edit', provider })"
          >
            <Pencil :size="14" />
          </button>
          <button
            class="icon-action"
            type="button"
            :aria-label="`${provider.isEnabled ? 'Disable' : 'Enable'} ${provider.name}`"
            :title="provider.isEnabled ? 'Disable' : 'Enable'"
            @click="toggleProvider(provider)"
          >
            <Power :size="14" />
          </button>
          <button
            class="icon-action icon-action--danger"
            type="button"
            :aria-label="`Delete ${provider.name}`"
            title="Delete"
            @click="showDialog({ kind: 'delete', provider })"
          >
            <Trash2 :size="14" />
          </button>
        </div>
      </template>
      <template #empty>
        <EmptyState :icon="Plug">
          <strong>No Providers yet.</strong
          ><span>Run <code>bun run db:seed</code> to load the Catalog, or add one by hand.</span>
        </EmptyState>
      </template>
    </DataTable>

    <ProviderFormDialog v-model:open="isFormOpen" :provider="editedProvider" @saved="refresh" />

    <AppDialog
      v-if="dialog?.kind === 'delete'"
      v-model:open="isDialogOpen"
      title="Delete Provider"
      :description="`${dialog.provider.name} is deleted with its Provider Accounts and Upstream Models. This can't be undone.`"
    >
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="closeDialog">Cancel</button>
        <button
          class="button button--danger"
          type="button"
          :disabled="isSaving"
          @click="deleteProvider(dialog.provider)"
        >
          Delete Provider
        </button>
      </div>
    </AppDialog>
  </div>
</template>
