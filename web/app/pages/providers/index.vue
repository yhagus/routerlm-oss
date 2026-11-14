<script setup lang="ts">
import { ChevronRight, CircleAlert, Pencil, Plus, Power, Search, Trash2 } from "@lucide/vue";
import { computed, ref } from "vue";
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

useHead({ title: "Providers" });

type ProviderDialog =
  | { kind: "create" }
  | { kind: "edit"; provider: Provider }
  | { kind: "delete"; provider: Provider };

const [
  { data: providers, error: loadError, refresh: refreshProviders },
  { data: accounts, error: accountsError, refresh: refreshAccounts },
  { data: models, error: modelsError, refresh: refreshModels },
] = await Promise.all([
  useDashboardApi<Provider[]>("/providers"),
  useDashboardApi<ProviderAccount[]>("/provider-accounts"),
  useDashboardApi<UpstreamModel[]>("/upstream-models"),
]);

/** Cooldowns are judged as of the last load. */
const loadedAt = ref(Date.now());

/** Deleting a Provider deletes its accounts and models, so every list reloads. */
async function refresh(): Promise<void> {
  await Promise.all([refreshProviders(), refreshAccounts(), refreshModels()]);
  loadedAt.value = Date.now();
}

/** Row stats need both lists; without them a row shows its configuration only. */
const hasStats = computed(() => !accountsError.value && !modelsError.value);

const rows = computed(() =>
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

// Held in the URL (?q=…&protocol=…&status=…) so a refresh or a link keeps them.
const searchText = useQueryParam("q", { default: "", isValid: anyText, debounce: 300 });
const protocolFilter = useQueryParam("protocol", {
  default: "",
  isValid: oneOf(["", ...UPSTREAM_PROTOCOLS]),
});
const statusFilter = useQueryParam("status", {
  default: "",
  isValid: oneOf(["", "enabled", "disabled", "attention"]),
});
const protocolFilterOptions = [{ label: "All Protocols", value: "" }, ...PROTOCOL_OPTIONS];
const statusFilterOptions = [
  { label: "Any status", value: "" },
  { label: "Enabled", value: "enabled" },
  { label: "Disabled", value: "disabled" },
  { label: "Needs attention", value: "attention" },
];

const visibleRows = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  return rows.value.filter(({ provider, stats }) => {
    if (protocolFilter.value && provider.protocol !== protocolFilter.value) return false;
    if (statusFilter.value === "enabled" && !provider.isEnabled) return false;
    if (statusFilter.value === "disabled" && provider.isEnabled) return false;
    if (statusFilter.value === "attention" && !stats.isUnroutable) return false;
    if (!query) return true;
    return [provider.name, provider.slug, provider.baseUrl].some((field) =>
      field.toLowerCase().includes(query),
    );
  });
});

function clearFilters(): void {
  searchText.value = "";
  protocolFilter.value = "";
  statusFilter.value = "";
}

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
  <PageHeading
    title="Providers"
    description="The upstream services the gateway calls, from the Catalog or added by hand. Any Provider that speaks a known Protocol can be added here."
  >
    <button class="button button--primary" type="button" @click="showDialog({ kind: 'create' })">
      <Plus :size="14" /> Add Provider
    </button>
  </PageHeading>

  <div v-if="loadError" class="panel empty-state empty-state--standalone">
    <strong>Couldn't load Providers.</strong
    ><span>Check that the backend is running, then reload the page.</span>
  </div>

  <template v-else>
    <section v-if="summary.providers > 0" class="executive-band executive-band--providers">
      <div class="executive-band__lead">
        <span class="metric-label">Enabled Providers</span>
        <strong class="tabular">{{ summary.enabled }}</strong
        ><span class="executive-band__of tabular">of {{ summary.providers }}</span>
        <p v-if="hasStats && summary.unroutable > 0" class="executive-band__alert">
          <CircleAlert :size="13" /> {{ summary.unroutable }} can't take traffic yet
        </p>
        <p v-else-if="hasStats">Every enabled Provider has a ready key and a model.</p>
      </div>
      <div class="executive-band__stat">
        <span>Ready accounts</span>
        <strong class="tabular">{{ hasStats ? summary.readyAccounts : "—" }}</strong>
        <small class="tabular">of {{ hasStats ? summary.accounts : "—" }} keys</small>
      </div>
      <div class="executive-band__stat">
        <span>Cooling down</span>
        <strong class="tabular">{{ hasStats ? summary.coolingAccounts : "—" }}</strong>
        <small>keys resting after errors</small>
      </div>
      <div class="executive-band__stat">
        <span>Enabled models</span>
        <strong class="tabular">{{ hasStats ? summary.enabledModels : "—" }}</strong>
        <small class="tabular">of {{ hasStats ? summary.models : "—" }} Upstream Models</small>
      </div>
    </section>

    <div
      v-if="summary.providers > 0"
      class="list-filters"
      role="group"
      aria-label="Filter Providers"
    >
      <label class="search-control">
        <Search :size="14" />
        <input
          v-model="searchText"
          type="search"
          placeholder="Search name, slug or URL"
          aria-label="Search Providers"
        />
      </label>
      <AppSelect
        v-model="protocolFilter"
        :options="protocolFilterOptions"
        label="Filter by Protocol"
      />
      <AppSelect v-model="statusFilter" :options="statusFilterOptions" label="Filter by status" />
      <span class="filter-note tabular">{{ visibleRows.length }} of {{ summary.providers }}</span>
    </div>

    <p v-if="!hasStats" class="form__hint provider-stats-note">
      Couldn't load Provider Accounts or Upstream Models, so the table shows configuration only.
    </p>

    <div v-if="summary.providers === 0" class="panel empty-state empty-state--standalone">
      <strong>No Providers yet.</strong
      ><span>Run <code>bun run db:seed</code> to load the Catalog, or add one by hand.</span>
    </div>
    <div v-else-if="visibleRows.length === 0" class="panel empty-state empty-state--standalone">
      <strong>No Provider matches these filters.</strong>
      <button class="text-button" type="button" @click="clearFilters">Clear filters</button>
    </div>

    <section v-else class="panel table-panel provider-table">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Protocol</th>
              <th>Status</th>
              <th>Accounts</th>
              <th>Models</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{ provider, stats } in visibleRows"
              :key="provider.id"
              :class="{ 'provider-table__row--off': !provider.isEnabled }"
            >
              <td>
                <NuxtLink class="table-entity provider-table__entity" :to="detailPath(provider)">
                  <ProviderLogo
                    :slug="provider.slug"
                    :name="provider.name"
                    :base-url="provider.baseUrl"
                  />
                  <span class="provider-table__name">
                    <strong :title="provider.name"
                      >{{ provider.name }}<ChevronRight :size="13" aria-hidden="true"
                    /></strong>
                    <span class="cell-note" :title="provider.baseUrl"
                      >{{ provider.slug }} · {{ baseUrlHost(provider.baseUrl) }}</span
                    >
                  </span>
                </NuxtLink>
              </td>
              <td>
                {{ PROTOCOL_LABELS[provider.protocol] }}
                <span class="cell-note"
                  >{{ provider.authStyle
                  }}<template v-if="provider.isFromCatalog"> · Catalog</template></span
                >
              </td>
              <td>
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
              </td>
              <td>
                <template v-if="hasStats">
                  <NuxtLink
                    class="provider-table__count tabular"
                    :to="detailPath(provider, 'accounts')"
                    >{{ stats.accounts.ready
                    }}<small> / {{ stats.accounts.total }} ready</small></NuxtLink
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
              </td>
              <td>
                <NuxtLink
                  v-if="hasStats"
                  class="provider-table__count tabular"
                  :to="detailPath(provider, 'models')"
                  >{{ stats.models.enabled }}<small> / {{ stats.models.total }} on</small></NuxtLink
                >
                <template v-else>—</template>
              </td>
              <td>
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

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
</template>
