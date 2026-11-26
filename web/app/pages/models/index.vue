<script setup lang="ts">
import { Boxes, Plus, Power } from '@lucide/vue';
import { apiErrorMessage } from '~/lib/api';
import { actionsColumn, type DataTableColumn } from '~/lib/dataTable';
import type { ModelDetail, ModelSummary } from '~/lib/routing';
import { MODEL_KIND_LABELS, MODEL_KIND_OPTIONS, type ModelKind } from '~/lib/upstream';

useHead({ title: 'Models' });

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: models,
  status: modelsStatus,
  error: loadError,
  refresh,
} = useDashboardApi<ModelSummary[]>('/models');
const isLoading = computed(() => modelsStatus.value === 'pending' && !models.value);

const columns: DataTableColumn<ModelSummary>[] = [
  { id: 'model', header: 'Model', enableHiding: false, accessorFn: (model) => model.name },
  { id: 'kind', header: 'Kind' },
  { id: 'routes', header: 'Routes' },
  { id: 'status', header: 'Status' },
  actionsColumn(),
];

const isCreateDialogOpen = ref(false);
const newModelName = ref('');
const newModelKind = ref<ModelKind>('chat');
const isSaving = ref(false);
const dialogError = ref('');

function openCreateDialog(): void {
  newModelName.value = '';
  newModelKind.value = 'chat';
  dialogError.value = '';
  isCreateDialogOpen.value = true;
}

async function createModel(): Promise<void> {
  isSaving.value = true;
  dialogError.value = '';
  try {
    const created = await $dashboardApi<Pick<ModelDetail, 'id' | 'name'>>('/models', {
      method: 'POST',
      body: { name: newModelName.value, kind: newModelKind.value },
    });
    showToast(`Created ${created.name}. Add its Routes next.`);
    await navigateTo(`/models/${created.id}`);
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't create the Model.");
  } finally {
    isSaving.value = false;
  }
}

async function toggleModel(model: ModelSummary): Promise<void> {
  try {
    await $dashboardApi(`/models/${model.id}`, {
      method: 'PATCH',
      body: { isEnabled: !model.isEnabled },
    });
    showToast(`${model.isEnabled ? 'Disabled' : 'Enabled'} ${model.name}`);
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't update ${model.name}.`));
  }
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Models"
      description="The model names clients send. Each Model tries its Routes in order until one serves the request."
    >
      <button class="button button--primary" type="button" @click="openCreateDialog">
        <Plus :size="14" /> Create Model
      </button>
    </PageHeading>

    <DataTable
      table-id="models"
      label="Models"
      search-placeholder="Search name"
      :columns="columns"
      :rows="models ?? []"
      :get-row-id="(model) => model.id"
      :is-loading="isLoading"
      :error="loadError"
      :refresh="refresh"
    >
      <template #cell-model="{ row: model }">
        <NuxtLink class="table-entity" :to="`/models/${model.id}`">
          <span class="key-icon"><Boxes :size="15" /></span><strong>{{ model.name }}</strong>
        </NuxtLink>
      </template>
      <template #cell-kind="{ row: model }">{{ MODEL_KIND_LABELS[model.kind] }}</template>
      <template #cell-routes="{ row: model }">
        <span class="tabular">{{ model.routeCount }}</span>
        <span v-if="model.routeCount === 0" class="status-badge status-badge--warn">No Routes</span>
      </template>
      <template #cell-status="{ row: model }">
        <span
          class="status-badge"
          :class="model.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
          >{{ model.isEnabled ? 'Enabled' : 'Disabled' }}</span
        >
      </template>
      <template #cell-actions="{ row: model }">
        <div class="row-actions">
          <button class="row-action" @click="toggleModel(model)">
            <Power :size="14" /> {{ model.isEnabled ? 'Disable' : 'Enable' }}
          </button>
        </div>
      </template>
      <template #empty>
        <EmptyState :icon="Boxes">
          <strong>No Models yet.</strong
          ><span>Create one with the name clients will send, then add its Routes.</span>
        </EmptyState>
      </template>
    </DataTable>

    <AppDialog
      v-model:open="isCreateDialogOpen"
      title="Create Model"
      description="Clients send this name as the model. It must be unique."
    >
      <form class="form" @submit.prevent="createModel">
        <label class="field"
          ><span class="field__label">Name</span
          ><input v-model="newModelName" class="text-input" autocomplete="off" required
        /></label>
        <div class="field">
          <span class="field__label">Kind</span>
          <AppSelect v-model="newModelKind" :options="MODEL_KIND_OPTIONS" label="Kind" />
        </div>
        <p class="form__hint">
          What the Model produces. Its Routes can only go to Upstream Models of this Kind, and it
          can't be changed later.
        </p>
        <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="isCreateDialogOpen = false">Cancel</button>
          <button class="button button--primary" type="submit" :disabled="isSaving">
            Create Model
          </button>
        </div>
      </form>
    </AppDialog>
  </div>
</template>
