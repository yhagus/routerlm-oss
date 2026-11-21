<script setup lang="ts">
import { Blocks, CirclePause, CirclePlay, Pencil, Plus, RefreshCw, Trash2 } from "@lucide/vue";
import type { RowAction } from "~/components/RowActionsMenu.vue";
import { apiErrorMessage } from "~/lib/api";
import type { ModelChoice } from "~/lib/api-keys";
import { actionsColumn, type DataTableColumn } from "~/lib/dataTable";
import { dateFormat } from "~/lib/dateFormats";
import {
  type CreatedIntegration,
  type IntegrationStatus,
  type IntegrationSummary,
  integrationStatus,
} from "~/lib/integrations";

useHead({ title: "Integrations" });

const STATUS_LABELS = {
  enabled: "Enabled",
  disabled: "Disabled",
} as const satisfies Record<IntegrationStatus, string>;

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: integrations,
  error: loadError,
  status: integrationsStatus,
  refresh,
} = useDashboardApi<IntegrationSummary[]>("/integrations");
const { data: modelChoices, status: modelChoicesStatus } =
  useDashboardApi<ModelChoice[]>("/api-keys/model-choices");

/** Only the first load shows placeholders; a refresh keeps the current rows until it lands. */
const isLoadingIntegrations = computed(
  () => integrationsStatus.value === "pending" && !integrations.value,
);
// Saving before the choices arrive would silently allow every Model.
const isLoadingModelChoices = computed(
  () => modelChoicesStatus.value === "pending" && !modelChoices.value,
);

function formatDate(value: string): string {
  return dateFormat.format(new Date(value));
}

interface IntegrationRow extends IntegrationSummary {
  status: IntegrationStatus;
}

const rows = computed<IntegrationRow[]>(() =>
  (integrations.value ?? []).map((integration) => ({
    ...integration,
    status: integrationStatus(integration),
  })),
);

const columns: DataTableColumn<IntegrationRow>[] = [
  { id: "name", header: "Name", enableHiding: false, accessorFn: (row) => row.name },
  { id: "allowedModels", header: "Allowed Models", accessorFn: allowedModelsLabel },
  { id: "created", header: "Created" },
  { id: "createdBy", header: "Created by", accessorFn: (row) => row.createdBy?.email ?? "" },
  { id: "lastRotated", header: "Last rotated" },
  { id: "status", header: "Status" },
  actionsColumn(),
];

function allowedModelsLabel(integration: IntegrationSummary): string {
  if (integration.allowedModels.length === 0) return "All Models";
  return integration.allowedModels.map((model) => model.name ?? "Deleted Model").join(", ");
}

// Create and edit

const editing = ref<IntegrationSummary | undefined>(undefined);
const isFormOpen = ref(false);

function openCreateDialog(): void {
  editing.value = undefined;
  isFormOpen.value = true;
}

async function handleCreated(integration: CreatedIntegration): Promise<void> {
  isFormOpen.value = false;
  revealed.value = { integration, verb: "created" };
  await refresh();
}

async function handleUpdated(integration: IntegrationSummary): Promise<void> {
  isFormOpen.value = false;
  showToast(`Saved ${integration.name}`);
  await refresh();
}

// The Integration Secret, shown once right after creating or rotating it

const revealed = ref<{ integration: CreatedIntegration; verb: "created" | "rotated" } | null>(null);
const isRevealOpen = computed({
  get: () => revealed.value !== null,
  set: (isOpen) => {
    if (!isOpen) revealed.value = null;
  },
});

// Disable and enable: one click each, undone by the other

async function setEnabled(integration: IntegrationSummary, isEnabled: boolean): Promise<void> {
  const action = isEnabled ? "enable" : "disable";
  try {
    await $dashboardApi(`/integrations/${integration.id}/${action}`, { method: "POST" });
    showToast(`${isEnabled ? "Enabled" : "Disabled"} ${integration.name}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't ${action} ${integration.name}.`));
  }
}

// Rotate and delete share one confirmation dialog

type Confirmation = { kind: "rotate" | "delete"; integration: IntegrationSummary };
const confirming = ref<Confirmation | null>(null);
const isConfirming = ref(false);
const confirmError = ref("");
const isConfirmOpen = computed({
  get: () => confirming.value !== null,
  set: (isOpen) => {
    if (!isOpen) confirming.value = null;
  },
});

const CONFIRM_COPY = {
  rotate: {
    title: "Rotate Integration Secret",
    description: (name: string) =>
      `${name} gets a new Integration Secret, and the current one is refused at once. Its API Keys keep working.`,
    action: "Rotate secret",
    failed: "Couldn't rotate the Integration Secret.",
  },
  delete: {
    title: "Delete Integration",
    description: (name: string) =>
      `${name} is deleted for good and all its API Keys are revoked, so its Customers are refused at once. This can't be undone; disable it instead to suspend it.`,
    action: "Delete Integration",
    failed: "Couldn't delete the Integration.",
  },
} as const;

async function confirmAction(): Promise<void> {
  const current = confirming.value;
  if (!current) return;
  isConfirming.value = true;
  confirmError.value = "";
  try {
    if (current.kind === "rotate") {
      const rotated = await $dashboardApi<CreatedIntegration>(
        `/integrations/${current.integration.id}/rotate`,
        { method: "POST" },
      );
      confirming.value = null;
      revealed.value = { integration: rotated, verb: "rotated" };
    } else {
      await $dashboardApi(`/integrations/${current.integration.id}`, { method: "DELETE" });
      showToast(`Deleted ${current.integration.name}`);
      confirming.value = null;
    }
    await refresh();
  } catch (error) {
    confirmError.value = apiErrorMessage(error, CONFIRM_COPY[current.kind].failed);
  } finally {
    isConfirming.value = false;
  }
}

// Row menu

type IntegrationActionId = "edit" | "rotate" | "disable" | "enable" | "delete";

function actionsFor(integration: IntegrationRow): RowAction<IntegrationActionId>[] {
  const toggle: RowAction<IntegrationActionId> =
    integration.status === "enabled"
      ? { id: "disable", label: "Disable", icon: CirclePause }
      : { id: "enable", label: "Enable", icon: CirclePlay };
  return [
    { id: "edit", label: "Edit", icon: Pencil },
    { id: "rotate", label: "Rotate secret", icon: RefreshCw },
    toggle,
    { id: "delete", label: "Delete", icon: Trash2, isDestructive: true },
  ];
}

function handleAction(integration: IntegrationRow, id: IntegrationActionId): void {
  if (id === "edit") {
    editing.value = integration;
    isFormOpen.value = true;
  } else if (id === "disable" || id === "enable") {
    void setEnabled(integration, id === "enable");
  } else {
    confirmError.value = "";
    confirming.value = { kind: id, integration };
  }
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Integrations"
      description="Outside applications that issue API Keys to their own Customers and read their usage."
    >
      <button class="button button--primary" type="button" @click="openCreateDialog">
        <Plus :size="14" /> Create Integration
      </button>
    </PageHeading>

    <DataTable
      table-id="integrations"
      label="Integrations"
      search-placeholder="Search name, Model or creator"
      :columns="columns"
      :rows="rows"
      :get-row-id="(row) => row.id"
      :row-class="(row) => ({ 'row--receded': row.status === 'disabled' })"
      :is-loading="isLoadingIntegrations"
      :error="loadError"
      :refresh="refresh"
    >
      <template #cell-name="{ row: integration }">
        <div class="table-entity">
          <span class="key-icon"><Blocks :size="15" /></span><strong>{{ integration.name }}</strong>
        </div>
      </template>
      <template #cell-allowedModels="{ row: integration }">
        <span class="models-summary" :title="allowedModelsLabel(integration)">{{
          allowedModelsLabel(integration)
        }}</span>
      </template>
      <template #cell-created="{ row: integration }">
        <span class="tabular">{{ formatDate(integration.createdAt) }}</span>
      </template>
      <template #cell-createdBy="{ row: integration }">{{
        integration.createdBy?.email ?? "—"
      }}</template>
      <template #cell-lastRotated="{ row: integration }">
        <span v-if="integration.lastRotatedAt" class="tabular">{{
          formatDate(integration.lastRotatedAt)
        }}</span>
        <span v-else class="value-never">Never</span>
      </template>
      <template #cell-status="{ row: integration }">
        <span
          class="status-badge"
          :class="integration.status === 'enabled' ? 'status-badge--good' : 'status-badge--bad'"
          >{{ STATUS_LABELS[integration.status] }}</span
        >
      </template>
      <template #cell-actions="{ row: integration }">
        <div class="row-actions">
          <RowActionsMenu
            :label="`Actions for ${integration.name}`"
            :actions="actionsFor(integration)"
            @select="(id) => handleAction(integration, id)"
          />
        </div>
      </template>
      <template #empty>
        <EmptyState :icon="Blocks">
          <strong>No Integrations yet.</strong
          ><span
            >Create one for each outside application that issues API Keys to its Customers.</span
          >
        </EmptyState>
      </template>
    </DataTable>

    <IntegrationFormDialog
      v-model:open="isFormOpen"
      :integration="editing"
      :model-choices="modelChoices ?? undefined"
      :is-loading-model-choices="isLoadingModelChoices"
      @created="handleCreated"
      @updated="handleUpdated"
    />

    <IntegrationSecretDialog
      v-if="revealed"
      v-model:open="isRevealOpen"
      :integration="revealed.integration"
      :verb="revealed.verb"
    />

    <AppDialog
      v-if="confirming"
      v-model:open="isConfirmOpen"
      :title="CONFIRM_COPY[confirming.kind].title"
      :description="CONFIRM_COPY[confirming.kind].description(confirming.integration.name)"
    >
      <p v-if="confirmError" class="form__error" role="alert">{{ confirmError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="confirming = null">Cancel</button>
        <button
          class="button"
          :class="confirming.kind === 'delete' ? 'button--danger' : 'button--primary'"
          type="button"
          :disabled="isConfirming"
          @click="confirmAction"
        >
          {{ CONFIRM_COPY[confirming.kind].action }}
        </button>
      </div>
    </AppDialog>
  </div>
</template>
