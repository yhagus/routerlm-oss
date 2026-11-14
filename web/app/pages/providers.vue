<script setup lang="ts">
import {
  ArrowUpRight,
  CircleAlert,
  KeyRound,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
} from "@lucide/vue";
import { computed, ref } from "vue";
import {
  baseUrlHost,
  formatContext,
  formatPriceRange,
  providerStats,
  type ProviderStats,
} from "~/lib/providerOverview";
import {
  type AuthStyle,
  type Provider,
  type ProviderAccount,
  type ProviderQuirks,
  type UpstreamModel,
  REASONING_CONTENT_IN_HISTORY,
  UPSTREAM_PROTOCOLS,
} from "~/lib/upstream";

useHead({ title: "Providers" });

type ProviderDialog =
  | { kind: "create" }
  | { kind: "edit"; provider: Provider }
  | { kind: "delete"; provider: Provider };

const { $dashboardApi } = useNuxtApp();
const [
  { data: providers, error: loadError, refresh: refreshProviders },
  { data: accounts, error: accountsError, refresh: refreshAccounts },
  { data: models, error: modelsError, refresh: refreshModels },
] = await Promise.all([
  useDashboardApi<Provider[]>("/providers"),
  useDashboardApi<ProviderAccount[]>("/provider-accounts"),
  useDashboardApi<UpstreamModel[]>("/upstream-models"),
]);

/** Cooldowns are judged as of the last load, like the Provider Accounts page. */
const loadedAt = ref(Date.now());

/** Deleting a Provider deletes its accounts and models, so every list reloads. */
async function refresh(): Promise<void> {
  await Promise.all([refreshProviders(), refreshAccounts(), refreshModels()]);
  loadedAt.value = Date.now();
}

/** Card stats need both lists; without them a card shows its configuration only. */
const hasStats = computed(() => !accountsError.value && !modelsError.value);

const cards = computed(() =>
  (providers.value ?? []).map((provider) => ({
    provider,
    stats: providerStats(provider, accounts.value ?? [], models.value ?? [], loadedAt.value),
  })),
);

const summary = computed(() => {
  const all = cards.value;
  const sum = (pick: (stats: ProviderStats) => number) =>
    all.reduce((total, card) => total + pick(card.stats), 0);
  return {
    providers: all.length,
    enabled: all.filter((card) => card.provider.isEnabled).length,
    unroutable: all.filter((card) => card.stats.isUnroutable).length,
    accounts: sum((stats) => stats.accounts.total),
    readyAccounts: sum((stats) => stats.accounts.ready),
    coolingAccounts: sum((stats) => stats.accounts.cooldown),
    models: sum((stats) => stats.models.total),
    enabledModels: sum((stats) => stats.models.enabled),
  };
});

const searchText = ref("");
const protocolFilter = ref("");
const statusFilter = ref("");
const protocolFilterOptions = [
  { label: "All Protocols", value: "" },
  ...UPSTREAM_PROTOCOLS.map((protocol) => ({ label: protocol, value: protocol })),
];
const statusFilterOptions = [
  { label: "Any status", value: "" },
  { label: "Enabled", value: "enabled" },
  { label: "Disabled", value: "disabled" },
  { label: "Needs attention", value: "attention" },
];

const visibleCards = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  return cards.value.filter(({ provider, stats }) => {
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

/** Why an enabled Provider can't take traffic, for its card. */
function unroutableReason(stats: ProviderStats): string {
  if (stats.accounts.total === 0) return "No Provider Account: add a key before routing here.";
  if (stats.accounts.ready === 0) {
    return "No ready Provider Account: every key is disabled or cooling down.";
  }
  return "No enabled Upstream Model: enable one before routing here.";
}

function accountSegments(stats: ProviderStats) {
  return [
    { key: "ready", name: "Ready", value: stats.accounts.ready },
    { key: "cooldown", name: "Cooling down", value: stats.accounts.cooldown },
    { key: "disabled", name: "Disabled", value: stats.accounts.disabled },
  ].filter((segment) => segment.value > 0);
}

const protocolOptions = UPSTREAM_PROTOCOLS.map((protocol) => ({
  label: protocol,
  value: protocol,
}));
const authStyleOptions = [
  { label: "Authorization: Bearer", value: "bearer" },
  { label: "x-api-key header", value: "x-api-key" },
] satisfies { label: string; value: AuthStyle }[];
const reasoningOptions = [
  { label: "Not needed", value: "" },
  { label: "Every assistant turn", value: "all-assistant-turns" },
  { label: "Turns with tool calls", value: "tool-call-turns" },
];

const {
  dialog,
  isDialogOpen,
  isSaving,
  dialogError,
  showDialog,
  closeDialog,
  submitDialog,
  deleteRow,
  toggleRow,
} = useEditableList<ProviderDialog>("/providers", refresh);

interface ProviderForm {
  slug: string;
  name: string;
  protocol: string;
  baseUrl: string;
  authStyle: string;
  reasoningContentInHistory: string;
  acceptsCacheControl: boolean;
  acceptsPromptCacheKey: boolean;
  usesMaxCompletionTokens: boolean;
  /** Blank means the default (four); the number input gives a number otherwise. */
  cacheMarkerLimit: number | "";
}

const form = ref<ProviderForm>({
  slug: "",
  name: "",
  protocol: "openai-chat",
  baseUrl: "",
  authStyle: "bearer",
  reasoningContentInHistory: "",
  acceptsCacheControl: false,
  acceptsPromptCacheKey: false,
  usesMaxCompletionTokens: false,
  cacheMarkerLimit: "",
});

function openDialog(next: ProviderDialog): void {
  showDialog(next);
  if (next.kind === "delete") return;
  const provider = next.kind === "edit" ? next.provider : undefined;
  form.value = {
    slug: provider?.slug ?? "",
    name: provider?.name ?? "",
    protocol: provider?.protocol ?? "openai-chat",
    baseUrl: provider?.baseUrl ?? "",
    authStyle: provider?.authStyle ?? "bearer",
    reasoningContentInHistory: provider?.quirks.reasoningContentInHistory ?? "",
    acceptsCacheControl: provider?.quirks.acceptsCacheControl ?? false,
    acceptsPromptCacheKey: provider?.quirks.acceptsPromptCacheKey ?? false,
    usesMaxCompletionTokens: provider?.quirks.usesMaxCompletionTokens ?? false,
    cacheMarkerLimit: provider?.quirks.cacheMarkerLimit ?? "",
  };
}

/** Only the quirks that are set; the backend rejects unknown keys. */
function quirksFromForm(): ProviderQuirks {
  if (form.value.protocol === "anthropic-messages") {
    const limit = form.value.cacheMarkerLimit;
    return limit === "" ? {} : { cacheMarkerLimit: limit };
  }
  if (form.value.protocol !== "openai-chat") return {};
  const quirks: ProviderQuirks = {};
  const reasoning = REASONING_CONTENT_IN_HISTORY.find(
    (value) => value === form.value.reasoningContentInHistory,
  );
  if (reasoning) quirks.reasoningContentInHistory = reasoning;
  if (form.value.acceptsCacheControl) quirks.acceptsCacheControl = true;
  if (form.value.acceptsPromptCacheKey) quirks.acceptsPromptCacheKey = true;
  if (form.value.usesMaxCompletionTokens) quirks.usesMaxCompletionTokens = true;
  return quirks;
}

async function saveProvider(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === "delete") return;
  const fields = {
    name: form.value.name,
    protocol: form.value.protocol,
    baseUrl: form.value.baseUrl,
    authStyle: form.value.authStyle,
    quirks: quirksFromForm(),
  };
  const failureMessage = "Couldn't save the Provider.";
  if (current.kind === "create") {
    await submitDialog(
      () =>
        $dashboardApi("/providers", { method: "POST", body: { slug: form.value.slug, ...fields } }),
      `Added ${fields.name}`,
      failureMessage,
    );
    return;
  }
  await submitDialog(
    () => $dashboardApi(`/providers/${current.provider.id}`, { method: "PATCH", body: fields }),
    `Saved ${fields.name}`,
    failureMessage,
  );
}

function deleteProvider(provider: Provider): Promise<void> {
  return deleteRow(provider, provider.name, "Couldn't delete the Provider.");
}

function toggleProvider(provider: Provider): Promise<void> {
  return toggleRow(provider, provider.name);
}

const QUIRK_LABELS: Record<keyof ProviderQuirks, string> = {
  reasoningContentInHistory: "reasoning in history",
  acceptsCacheControl: "cache_control",
  acceptsPromptCacheKey: "prompt_cache_key",
  usesMaxCompletionTokens: "max_completion_tokens",
  cacheMarkerLimit: "cache marker limit",
};

function quirkLabels(quirks: ProviderQuirks): string[] {
  return Object.entries(QUIRK_LABELS)
    .filter(([key]) => Object.hasOwn(quirks, key))
    .map(([, label]) => label);
}
</script>

<template>
  <PageHeading
    title="Providers"
    description="The upstream services the gateway calls, from the Catalog or added by hand. Any Provider that speaks a known Protocol can be added here."
  >
    <button class="button button--primary" type="button" @click="openDialog({ kind: 'create' })">
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
      class="provider-filters"
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
      <span class="filter-note tabular">{{ visibleCards.length }} of {{ summary.providers }}</span>
    </div>

    <p v-if="!hasStats" class="form__hint provider-stats-note">
      Couldn't load Provider Accounts or Upstream Models, so cards show configuration only.
    </p>

    <div v-if="summary.providers === 0" class="panel empty-state empty-state--standalone">
      <strong>No Providers yet.</strong
      ><span>Run <code>bun run db:seed</code> to load the Catalog, or add one by hand.</span>
    </div>
    <div v-else-if="visibleCards.length === 0" class="panel empty-state empty-state--standalone">
      <strong>No Provider matches these filters.</strong>
      <button class="text-button" type="button" @click="clearFilters">Clear filters</button>
    </div>

    <ul v-else class="provider-grid">
      <li
        v-for="{ provider, stats } in visibleCards"
        :key="provider.id"
        class="provider-card panel"
        :class="{ 'provider-card--off': !provider.isEnabled }"
      >
        <header class="provider-card__head">
          <ProviderLogo :slug="provider.slug" :name="provider.name" :base-url="provider.baseUrl" />
          <div class="provider-card__title">
            <h2 :title="provider.name">{{ provider.name }}</h2>
            <span class="cell-note">{{ provider.slug }}</span>
          </div>
          <span
            class="status-badge"
            :class="provider.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
            >{{ provider.isEnabled ? "Enabled" : "Disabled" }}</span
          >
        </header>

        <div class="provider-card__meta">
          <span class="tag">{{ provider.protocol }}</span>
          <span class="tag"><KeyRound :size="11" />{{ provider.authStyle }}</span>
          <span v-if="provider.isFromCatalog" class="tag">Catalog</span>
          <span class="provider-card__host" :title="provider.baseUrl">{{
            baseUrlHost(provider.baseUrl)
          }}</span>
        </div>

        <template v-if="hasStats">
          <dl class="provider-card__stats">
            <div>
              <dt>Accounts</dt>
              <dd class="tabular">
                {{ stats.accounts.ready }}<small>/{{ stats.accounts.total }} ready</small>
              </dd>
            </div>
            <div>
              <dt>Models</dt>
              <dd class="tabular">
                {{ stats.models.enabled }}<small>/{{ stats.models.total }} on</small>
              </dd>
            </div>
            <div>
              <dt>Max context</dt>
              <dd class="tabular">{{ formatContext(stats.maxContext) }}</dd>
            </div>
            <div>
              <dt>Input $/M</dt>
              <dd class="tabular">{{ formatPriceRange(stats.inputPrice) }}</dd>
            </div>
          </dl>

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

          <div
            v-if="stats.capabilities.length || quirkLabels(provider.quirks).length"
            class="provider-card__chips"
          >
            <span v-for="capability in stats.capabilities" :key="capability" class="chip">{{
              capability
            }}</span>
            <span
              v-for="quirk in quirkLabels(provider.quirks)"
              :key="quirk"
              class="chip chip--quiet"
              title="Quirk"
              >{{ quirk }}</span
            >
          </div>

          <p v-if="stats.isUnroutable" class="provider-card__alert">
            <CircleAlert :size="13" /> {{ unroutableReason(stats) }}
          </p>
        </template>

        <footer class="provider-card__foot">
          <NuxtLink class="row-action" to="/provider-accounts"
            >Accounts <ArrowUpRight :size="13"
          /></NuxtLink>
          <NuxtLink class="row-action" to="/upstream-models"
            >Models <ArrowUpRight :size="13"
          /></NuxtLink>
          <div class="row-actions">
            <button
              class="icon-action"
              type="button"
              :aria-label="`Edit ${provider.name}`"
              title="Edit"
              @click="openDialog({ kind: 'edit', provider })"
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
              @click="openDialog({ kind: 'delete', provider })"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </footer>
      </li>
    </ul>
  </template>

  <AppDialog
    v-if="dialog && dialog.kind !== 'delete'"
    v-model:open="isDialogOpen"
    wide
    :title="dialog.kind === 'create' ? 'Add Provider' : `Edit ${dialog.provider.name}`"
    description="The base URL is what the Protocol's path is appended to: /chat/completions for openai-chat, /v1/messages for anthropic-messages."
  >
    <form class="form" @submit.prevent="saveProvider">
      <div class="form__grid">
        <label class="field"
          ><span class="field__label">Name</span
          ><input v-model="form.name" class="text-input" required
        /></label>
        <label class="field"
          ><span class="field__label">Slug</span
          ><input
            v-model="form.slug"
            class="text-input"
            pattern="[a-z0-9-]+"
            title="Lowercase letters, digits and dashes"
            :disabled="dialog.kind === 'edit'"
            required
        /></label>
        <div class="field">
          <span class="field__label">Protocol</span>
          <AppSelect v-model="form.protocol" :options="protocolOptions" label="Protocol" />
        </div>
        <div class="field">
          <span class="field__label">Authentication</span>
          <AppSelect v-model="form.authStyle" :options="authStyleOptions" label="Authentication" />
        </div>
      </div>
      <label class="field"
        ><span class="field__label">Base URL</span
        ><input v-model="form.baseUrl" class="text-input" type="url" required
      /></label>
      <template v-if="form.protocol === 'openai-chat'">
        <div class="field">
          <span class="field__label">Reasoning content in history</span>
          <AppSelect
            v-model="form.reasoningContentInHistory"
            :options="reasoningOptions"
            label="Reasoning content in history"
          />
        </div>
        <fieldset class="check-group">
          <label class="check-field"
            ><input v-model="form.acceptsCacheControl" type="checkbox" /> Accepts cache_control
            markers</label
          >
          <label class="check-field"
            ><input v-model="form.acceptsPromptCacheKey" type="checkbox" /> Accepts
            prompt_cache_key</label
          >
          <label class="check-field"
            ><input v-model="form.usesMaxCompletionTokens" type="checkbox" /> Wants
            max_completion_tokens</label
          >
        </fieldset>
      </template>
      <label v-if="form.protocol === 'anthropic-messages'" class="field"
        ><span class="field__label">Cache marker limit</span
        ><input
          v-model.number="form.cacheMarkerLimit"
          class="text-input"
          type="number"
          min="0"
          step="1"
          placeholder="4"
      /></label>
      <p v-if="form.protocol === 'anthropic-messages'" class="form__hint">
        How many cache markers the gateway may add to a request. 0 adds none; blank means 4.
      </p>
      <p v-if="dialog.kind === 'edit' && dialog.provider.isFromCatalog" class="form__hint">
        From the Catalog. Your edits are kept: seeding never overwrites an existing Provider.
      </p>
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="closeDialog">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ dialog.kind === "create" ? "Add Provider" : "Save" }}
        </button>
      </div>
    </form>
  </AppDialog>

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
