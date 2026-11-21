<script setup lang="ts">
import { ArrowLeft, CloudOff, Pencil, Power, RefreshCw, Trash2 } from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import type { IntegrationConfirmation } from "~/components/IntegrationConfirmDialog.vue";
import { apiErrorMessage } from "~/lib/api";
import type { ModelChoice } from "~/lib/api-keys";
import { dateFormat } from "~/lib/dateFormats";
import { isNotFound } from "~/lib/errors";
import {
  type CreatedIntegration,
  INTEGRATION_STATUS_LABELS,
  type IntegrationDetail,
  type IntegrationSummary,
  integrationStatus,
} from "~/lib/integrations";
import { formatCount } from "~/lib/usage";

const TABS = ["overview", "api-keys", "customers", "usage", "models", "secret-history"] as const;
type Tab = (typeof TABS)[number];

const integrationId = String(useRoute().params.id);
const integrationPath = `/integrations/${integrationId}`;

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: integration,
  error: loadError,
  refresh,
} = useDashboardApi<IntegrationDetail>(integrationPath);
useMissingResource(() => isNotFound(loadError.value), "Integration");
const { data: modelChoices, status: modelChoicesStatus } =
  useDashboardApi<ModelChoice[]>("/api-keys/model-choices");
// Saving before the choices arrive would silently allow every Model.
const isLoadingModelChoices = computed(
  () => modelChoicesStatus.value === "pending" && !modelChoices.value,
);

useHead({ title: () => integration.value?.name ?? "Integration" });

const status = computed(() => (integration.value ? integrationStatus(integration.value) : null));
const totalKeyCount = computed(() =>
  integration.value ? integration.value.activeKeyCount + integration.value.revokedKeyCount : 0,
);

/** The open tab lives in `?tab=` so a link can open it directly. */
const activeTab = useQueryParam<Tab>("tab", { default: "overview", isValid: oneOf(TABS) });
// Each tab's table keeps its search and page in `?q=` and `?page=`; a new tab starts without them.
const search = useQuerySearch();
const page = useQueryPage();
watch(activeTab, () => {
  search.value = "";
  page.value = 1;
});

function formatDate(value: string): string {
  return dateFormat.format(new Date(value));
}

// Edit

const isFormOpen = ref(false);

async function handleUpdated(updated: IntegrationSummary): Promise<void> {
  isFormOpen.value = false;
  showToast(`Saved ${updated.name}`);
  await refresh();
}

// Disable and enable: one click each, undone by the other

async function toggleEnabled(): Promise<void> {
  if (!integration.value) return;
  const { name } = integration.value;
  const action = status.value === "enabled" ? "disable" : "enable";
  try {
    await $dashboardApi(`${integrationPath}/${action}`, { method: "POST" });
    showToast(`${action === "enable" ? "Enabled" : "Disabled"} ${name}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't ${action} ${name}.`));
  }
}

// Rotate and delete

const confirming = ref<IntegrationConfirmation | null>(null);

function openConfirm(kind: IntegrationConfirmation["kind"]): void {
  if (integration.value) confirming.value = { kind, integration: integration.value };
}

/** The new Integration Secret, shown once right after rotating it. */
const rotated = ref<CreatedIntegration | null>(null);
const isRotatedOpen = computed({
  get: () => rotated.value !== null,
  set: (isOpen) => {
    if (!isOpen) rotated.value = null;
  },
});

async function handleRotated(integrationWithSecret: CreatedIntegration): Promise<void> {
  rotated.value = integrationWithSecret;
  await refresh();
}

async function handleDeleted(deleted: IntegrationSummary): Promise<void> {
  showToast(`Deleted ${deleted.name}`);
  await navigateTo("/integrations");
}
</script>

<template>
  <div class="page-view">
    <NuxtLink class="back-link" to="/integrations"><ArrowLeft :size="13" /> Integrations</NuxtLink>

    <EmptyState
      v-if="loadError"
      class="panel empty-state--standalone"
      :icon="CloudOff"
      tone="error"
    >
      <strong>Couldn't load this Integration.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>

    <template v-else-if="!integration || !status">
      <section class="provider-hero" aria-busy="true">
        <div class="provider-hero__title">
          <h1>Integration</h1>
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
      <section class="provider-hero" :class="{ 'provider-hero--off': status === 'disabled' }">
        <div class="provider-hero__title">
          <h1>{{ integration.name }}</h1>
          <p class="provider-hero__meta">
            <span class="tabular" title="The public id inside its Integration Secret"
              >rlmi_{{ integration.keyId }}_…</span
            >
            <span
              >Created <span class="tabular">{{ formatDate(integration.createdAt) }}</span> by
              {{ integration.createdBy?.email ?? "—" }}</span
            >
            <span
              >Last rotated
              <span v-if="integration.lastRotatedAt" class="tabular">{{
                formatDate(integration.lastRotatedAt)
              }}</span
              ><span v-else>Never</span></span
            >
            <span
              >Last used
              <span v-if="integration.lastUsedAt" class="tabular">{{
                formatDate(integration.lastUsedAt)
              }}</span
              ><span v-else>Never</span></span
            >
          </p>
          <p class="provider-hero__meta tabular">
            <span>{{ formatCount(integration.activeKeyCount) }} active API Keys</span>
            <span>{{ formatCount(integration.revokedKeyCount) }} revoked</span>
            <span>{{ formatCount(integration.customerCount) }} Customers</span>
          </p>
        </div>
        <div class="provider-hero__actions">
          <span
            class="status-badge"
            :class="status === 'enabled' ? 'status-badge--good' : 'status-badge--bad'"
            >{{ INTEGRATION_STATUS_LABELS[status] }}</span
          >
          <button class="button" type="button" @click="isFormOpen = true">
            <Pencil :size="14" /> Edit
          </button>
          <button class="button" type="button" @click="openConfirm('rotate')">
            <RefreshCw :size="14" /> Rotate secret
          </button>
          <button class="button" type="button" @click="toggleEnabled">
            <Power :size="14" /> {{ status === "enabled" ? "Disable" : "Enable" }}
          </button>
          <button
            class="icon-action icon-action--danger"
            type="button"
            :aria-label="`Delete ${integration.name}`"
            title="Delete"
            @click="openConfirm('delete')"
          >
            <Trash2 :size="15" />
          </button>
        </div>
      </section>

      <TabsRoot v-model="activeTab" class="tabs">
        <TabsList class="tabs__list" aria-label="Integration sections">
          <TabsTrigger class="tabs__trigger" value="overview">Overview</TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="api-keys">
            API Keys
            <span class="tabs__count tabular"
              >{{ formatCount(integration.activeKeyCount) }}/{{ formatCount(totalKeyCount) }}</span
            >
          </TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="customers">
            Customers
            <span class="tabs__count tabular">{{ formatCount(integration.customerCount) }}</span>
          </TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="usage">Usage</TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="models">Models</TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="secret-history">Secret history</TabsTrigger>
        </TabsList>

        <!-- Hidden tabs unmount: each table owns `?q=` and `?page=` while it is shown. -->
        <TabsContent value="overview" class="tabs__panel">
          <IntegrationOverviewPanel :integration-id="integrationId" />
        </TabsContent>
        <TabsContent value="api-keys" class="tabs__panel">
          <IntegrationApiKeysPanel :integration-id="integrationId" @revoked="refresh" />
        </TabsContent>
        <TabsContent value="customers" class="tabs__panel">
          <IntegrationCustomersPanel :integration-id="integrationId" />
        </TabsContent>
        <TabsContent value="usage" class="tabs__panel">
          <IntegrationUsagePanel :integration-id="integrationId" />
        </TabsContent>
        <TabsContent value="models" class="tabs__panel">
          <IntegrationModelsPanel :integration="integration" />
        </TabsContent>
        <TabsContent value="secret-history" class="tabs__panel">
          <IntegrationSecretHistory :integration="integration" />
        </TabsContent>
      </TabsRoot>

      <IntegrationFormDialog
        v-model:open="isFormOpen"
        :integration="integration"
        :model-choices="modelChoices ?? undefined"
        :is-loading-model-choices="isLoadingModelChoices"
        @updated="handleUpdated"
      />

      <IntegrationSecretDialog
        v-if="rotated"
        v-model:open="isRotatedOpen"
        :integration="rotated"
        verb="rotated"
      />

      <IntegrationConfirmDialog
        v-model:confirmation="confirming"
        @rotated="handleRotated"
        @deleted="handleDeleted"
      />
    </template>
  </div>
</template>
