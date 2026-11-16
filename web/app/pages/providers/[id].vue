<script setup lang="ts">
import { ArrowLeft, CircleAlert, CloudOff, Pencil, Plus, Power, Trash2 } from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { apiErrorMessage } from "~/lib/api";
import {
  accountStateOf,
  baseUrlHost,
  providerStats,
  unroutableReason,
} from "~/lib/providerOverview";
import {
  type Provider,
  type ProviderAccount,
  type UpstreamModel,
  PROTOCOL_LABELS,
} from "~/lib/upstream";

const TABS = ["accounts", "models", "configuration"] as const;
type Tab = (typeof TABS)[number];

const route = useRoute();
const providerId = String(route.params.id);

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
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

const isLoadingAccounts = computed(() => accountsStatus.value === "pending" && !accounts.value);
const isLoadingModels = computed(() => modelsStatus.value === "pending" && !models.value);

const provider = computed(() => providers.value?.find((each) => each.id === providerId));
const ownAccounts = computed(() =>
  (accounts.value ?? []).filter((account) => account.providerId === providerId),
);
const ownModels = computed(() =>
  (models.value ?? []).filter((model) => model.providerId === providerId),
);

useMissingResource(() => Boolean(providers.value) && !provider.value, "Provider");

useHead({ title: () => provider.value?.name ?? "Provider" });

/** Cooldowns are judged as of the last load. */
const loadedAt = ref(Date.now());

async function refresh(): Promise<void> {
  await Promise.all([refreshProviders(), refreshAccounts(), refreshModels()]);
  loadedAt.value = Date.now();
}

const stats = computed(() =>
  provider.value
    ? providerStats(provider.value, ownAccounts.value, ownModels.value, loadedAt.value)
    : null,
);
const readyAccounts = computed(
  () =>
    ownAccounts.value.filter((account) => accountStateOf(account, loadedAt.value) === "ready")
      .length,
);
const enabledModels = computed(() => ownModels.value.filter((model) => model.isEnabled).length);

/** The open tab lives in `?tab=` so the Providers list can link straight to it. */
const activeTab = useQueryParam<Tab>("tab", { default: "accounts", isValid: oneOf(TABS) });

const isEditOpen = ref(false);
const isDeleteOpen = ref(false);
const isDeleting = ref(false);
const deleteError = ref("");

function openDelete(): void {
  deleteError.value = "";
  isDeleteOpen.value = true;
}

async function deleteProvider(): Promise<void> {
  if (!provider.value) return;
  const { name } = provider.value;
  isDeleting.value = true;
  deleteError.value = "";
  try {
    await $dashboardApi(`/providers/${providerId}`, { method: "DELETE" });
    showToast(`Deleted ${name}`);
    isDeleteOpen.value = false;
    await navigateTo("/providers");
  } catch (error) {
    deleteError.value = apiErrorMessage(error, "Couldn't delete the Provider.");
  } finally {
    isDeleting.value = false;
  }
}

async function toggleProvider(): Promise<void> {
  if (!provider.value) return;
  const { isEnabled, name } = provider.value;
  try {
    await $dashboardApi(`/providers/${providerId}`, {
      method: "PATCH",
      body: { isEnabled: !isEnabled },
    });
    showToast(`${isEnabled ? "Disabled" : "Enabled"} ${name}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't update ${name}.`));
  }
}

const REASONING_LABELS: Record<string, string> = {
  "all-assistant-turns": "Every assistant turn",
  "tool-call-turns": "Turns with tool calls",
};

/** The request fields an openai-chat Provider takes, as the form names them. */
function requestFields(target: Provider): string {
  const fields = [
    target.quirks.acceptsCacheControl ? "cache_control markers" : null,
    target.quirks.acceptsPromptCacheKey ? "prompt_cache_key" : null,
    target.quirks.usesMaxCompletionTokens ? "max_completion_tokens" : null,
  ].filter((field) => field !== null);
  return fields.length ? fields.join(", ") : "None";
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

<template>
  <div class="page-view">
    <NuxtLink class="back-link" to="/providers"><ArrowLeft :size="13" /> Providers</NuxtLink>

    <EmptyState
      v-if="loadError"
      class="panel empty-state--standalone"
      :icon="CloudOff"
      tone="error"
    >
      <strong>Couldn't load this Provider.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>

    <template v-else-if="!provider">
      <section class="provider-hero" aria-busy="true">
        <div class="provider-hero__title">
          <h1>Provider</h1>
        </div>
        <div class="provider-hero__actions">
          <button class="button" type="button" disabled><Pencil :size="14" /> Edit</button>
        </div>
      </section>
      <section class="panel loading-panel" aria-busy="true">
        <AppSpinner />
      </section>
    </template>

    <template v-else>
      <section class="provider-hero" :class="{ 'provider-hero--off': !provider.isEnabled }">
        <ProviderLogo :logo="provider.logo" :name="provider.name" :base-url="provider.baseUrl" />
        <div class="provider-hero__title">
          <h1>{{ provider.name }}</h1>
          <p class="provider-hero__meta">
            <span>{{ PROTOCOL_LABELS[provider.protocol] }}</span>
            <span :title="provider.baseUrl">{{ baseUrlHost(provider.baseUrl) }}</span>
            <span>{{ provider.slug }}</span>
          </p>
        </div>
        <div class="provider-hero__actions">
          <span
            class="status-badge"
            :class="provider.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
            >{{ provider.isEnabled ? "Enabled" : "Disabled" }}</span
          >
          <button class="button" type="button" @click="isEditOpen = true">
            <Pencil :size="14" /> Edit
          </button>
          <button class="button" type="button" @click="toggleProvider">
            <Power :size="14" /> {{ provider.isEnabled ? "Disable" : "Enable" }}
          </button>
          <button
            class="icon-action icon-action--danger"
            type="button"
            :aria-label="`Delete ${provider.name}`"
            title="Delete"
            @click="openDelete"
          >
            <Trash2 :size="15" />
          </button>
        </div>
      </section>

      <p
        v-if="
          stats?.isUnroutable &&
          !isLoadingAccounts &&
          !isLoadingModels &&
          !accountsError &&
          !modelsError
        "
        class="provider-hero__alert"
      >
        <CircleAlert :size="13" /> {{ unroutableReason(stats) }}
      </p>

      <TabsRoot v-model="activeTab" class="tabs" :unmount-on-hide="false">
        <TabsList class="tabs__list" aria-label="Provider sections">
          <TabsTrigger class="tabs__trigger" value="accounts">
            Accounts
            <AppSpinner v-if="isLoadingAccounts" label="" />
            <span v-else class="tabs__count tabular"
              >{{ readyAccounts }}/{{ ownAccounts.length }}</span
            >
          </TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="models">
            Models
            <AppSpinner v-if="isLoadingModels" label="" />
            <span v-else class="tabs__count tabular"
              >{{ enabledModels }}/{{ ownModels.length }}</span
            >
          </TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="configuration">Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" class="tabs__panel">
          <EmptyState
            v-if="accountsError"
            class="panel empty-state--standalone"
            :icon="CloudOff"
            tone="error"
          >
            <strong>Couldn't load Provider Accounts.</strong
            ><span>Check that the backend is running, then reload the page.</span>
          </EmptyState>
          <ProviderAccountsPanel
            v-else
            :provider="provider"
            :accounts="ownAccounts"
            :refresh="refresh"
            :is-loading="isLoadingAccounts"
          />
        </TabsContent>

        <TabsContent value="models" class="tabs__panel">
          <UpstreamModelBrowser
            :provider="provider"
            :providers="providers ?? []"
            :upstream-models="models ?? []"
            :refresh="refresh"
            :is-loading="isLoadingModels"
            :error="modelsError"
          >
            <template #actions="{ openCreate }">
              <button class="button button--primary" type="button" @click="openCreate">
                <Plus :size="14" /> Add Model
              </button>
            </template>
          </UpstreamModelBrowser>
        </TabsContent>

        <TabsContent value="configuration" class="tabs__panel">
          <section class="panel">
            <div class="panel-heading">
              <div>
                <h2>Configuration</h2>
                <p>How the gateway calls {{ provider.name }}.</p>
              </div>
              <div class="panel-heading__tools">
                <button class="button" type="button" @click="isEditOpen = true">
                  <Pencil :size="14" /> Edit
                </button>
              </div>
            </div>
            <dl class="config-list">
              <div>
                <dt>Protocol</dt>
                <dd>
                  {{ PROTOCOL_LABELS[provider.protocol] }}
                  <span class="cell-note">{{ provider.protocol }}</span>
                </dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd class="config-list__url">{{ provider.baseUrl }}</dd>
              </div>
              <div>
                <dt>Authentication</dt>
                <dd>
                  {{
                    provider.authStyle === "bearer" ? "Authorization: Bearer" : "x-api-key header"
                  }}
                </dd>
              </div>
              <div>
                <dt>Slug</dt>
                <dd>{{ provider.slug }}</dd>
              </div>
              <template v-if="provider.protocol === 'openai-chat'">
                <div>
                  <dt>Reasoning in history</dt>
                  <dd>
                    {{
                      provider.quirks.reasoningContentInHistory
                        ? REASONING_LABELS[provider.quirks.reasoningContentInHistory]
                        : "Not needed"
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Request fields</dt>
                  <dd>{{ requestFields(provider) }}</dd>
                </div>
              </template>
              <div v-if="provider.protocol === 'anthropic-messages'">
                <dt>Cache marker limit</dt>
                <dd class="tabular">
                  {{ provider.quirks.cacheMarkerLimit ?? 4
                  }}<span v-if="provider.quirks.cacheMarkerLimit === undefined" class="cell-note"
                    >default</span
                  >
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{{ provider.isFromCatalog ? "Catalog" : "Added by hand" }}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd class="tabular">{{ dateFormat.format(new Date(provider.updatedAt)) }}</dd>
              </div>
            </dl>
          </section>
        </TabsContent>
      </TabsRoot>

      <ProviderFormDialog v-model:open="isEditOpen" :provider="provider" @saved="refresh" />

      <AppDialog
        v-model:open="isDeleteOpen"
        title="Delete Provider"
        :description="`${provider.name} is deleted with its Provider Accounts and Upstream Models. This can't be undone.`"
      >
        <p v-if="deleteError" class="form__error" role="alert">{{ deleteError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="isDeleteOpen = false">Cancel</button>
          <button
            class="button button--danger"
            type="button"
            :disabled="isDeleting"
            @click="deleteProvider"
          >
            Delete Provider
          </button>
        </div>
      </AppDialog>
    </template>
  </div>
</template>
