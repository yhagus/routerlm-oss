<script setup lang="ts">
import {
  ArrowLeft,
  CirclePause,
  CirclePlay,
  CloudOff,
  Pencil,
  RefreshCw,
  Trash2,
} from "@lucide/vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import type { IntegrationConfirmation } from "~/components/IntegrationConfirmDialog.vue";
import type { RowAction } from "~/components/RowActionsMenu.vue";
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
const isLoadingModelChoices = computed(
  () => modelChoicesStatus.value === "pending" && !modelChoices.value,
);

useHead({ title: () => integration.value?.name ?? "Integration" });

const status = computed(() => (integration.value ? integrationStatus(integration.value) : null));

const activeTab = useQueryParam<Tab>("tab", { default: "overview", isValid: oneOf(TABS) });
const search = useQuerySearch();
const page = useQueryPage();
watch(activeTab, () => {
  search.value = "";
  page.value = 1;
});

function formatDate(value: string): string {
  return dateFormat.format(new Date(value));
}

const isFormOpen = ref(false);

async function handleUpdated(updated: IntegrationSummary): Promise<void> {
  isFormOpen.value = false;
  showToast(`Saved ${updated.name}`);
  await refresh();
}

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

const confirming = ref<IntegrationConfirmation | null>(null);

function openConfirm(kind: IntegrationConfirmation["kind"]): void {
  if (integration.value) confirming.value = { kind, integration: integration.value };
}

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

type MoreActionId = "rotate" | "toggle" | "delete";

const moreActions = computed<RowAction<MoreActionId>[]>(() => [
  { id: "rotate", label: "Rotate secret", icon: RefreshCw },
  status.value === "enabled"
    ? { id: "toggle", label: "Disable", icon: CirclePause }
    : { id: "toggle", label: "Enable", icon: CirclePlay },
  { id: "delete", label: "Delete", icon: Trash2, isDestructive: true },
]);

function handleMoreAction(id: MoreActionId): void {
  if (id === "toggle") void toggleEnabled();
  else openConfirm(id);
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
              >rlmi_{{ integration.keyId }}</span
            >
            <span
              >Created <span class="tabular">{{ formatDate(integration.createdAt) }}</span></span
            >
            <span
              >Last used
              <span v-if="integration.lastUsedAt" class="tabular">{{
                formatDate(integration.lastUsedAt)
              }}</span
              ><span v-else>never</span></span
            >
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
          <RowActionsMenu
            :label="`More actions for ${integration.name}`"
            :actions="moreActions"
            @select="handleMoreAction"
          />
        </div>
      </section>

      <TabsRoot v-model="activeTab" class="tabs">
        <TabsList class="tabs__list" aria-label="Integration sections">
          <TabsTrigger class="tabs__trigger" value="overview">Overview</TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="api-keys">
            API Keys
            <span class="tabs__count tabular">{{ formatCount(integration.activeKeyCount) }}</span>
          </TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="customers">
            Customers
            <span class="tabs__count tabular">{{ formatCount(integration.customerCount) }}</span>
          </TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="usage">Usage</TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="models">Models</TabsTrigger>
          <TabsTrigger class="tabs__trigger" value="secret-history">Secret history</TabsTrigger>
        </TabsList>

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
