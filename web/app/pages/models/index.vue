<script setup lang="ts">
import { Boxes, Plus, Power } from '@lucide/vue';
import { type ActiveFilter, listFilterTokens } from '~/lib/activeFilters';
import { apiErrorMessage } from '~/lib/api';
import { actionsColumn, type DataTableColumn } from '~/lib/dataTable';
import {
  type ModelGroup,
  type ModelGroupRef,
  modelNameProblem,
  publishedModelName,
} from '~/lib/modelGroups';
import {
  DISPLAY_NAME_MAX_LENGTH,
  displayNameProblem,
  displayNameValue,
  type ModelDetail,
  modelLabelOf,
  modelSearchText,
  type ModelSummary,
} from '~/lib/routing';
import { isStack, stackByKey, type StackedRow } from '~/lib/stacks';
import { MODEL_KIND_LABELS, MODEL_KIND_OPTIONS, type ModelKind } from '~/lib/upstream';

useHead({ title: 'Models' });

interface Publication {
  model: ModelSummary;
  group: ModelGroupRef | null;
}

type ModelRow = StackedRow<Publication>;

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: models,
  status: modelsStatus,
  error: loadError,
  refresh,
} = useDashboardApi<ModelSummary[]>('/models');
const isLoading = computed(() => modelsStatus.value === 'pending' && !models.value);
const { data: groups } = useDashboardApi<ModelGroup[]>('/model-groups', { key: 'model-groups' });

const groupSlugs = computed(() => (groups.value ?? []).map((group) => group.slug));
const groupFilter = useQueryList('group', { isValid: anyText, order: groupSlugs });
const groupFilterOptions = computed(() => [
  ...(groups.value ?? []).map((group) => ({ label: group.name, value: group.slug })),
  ...groupFilter.value
    .filter((slug) => !groupSlugs.value.includes(slug))
    .map((slug) => ({ label: `${slug} (not found)`, value: slug })),
]);
const activeFilters = computed<ActiveFilter[]>(() =>
  listFilterTokens('Group', groupFilter, groupFilterOptions.value),
);

function publicationsOf(model: ModelSummary): Publication[] {
  if (model.groups.length === 0) return [{ model, group: null }];
  return model.groups.map((group) => ({ model, group }));
}

function isShownByGroupFilter(publication: Publication): boolean {
  if (groupFilter.value.length === 0) return true;
  return publication.group !== null && groupFilter.value.includes(publication.group.slug);
}

function comparePublications(first: Publication, second: Publication): number {
  return (
    modelLabelOf(first.model).label.localeCompare(modelLabelOf(second.model).label) ||
    (first.group?.slug ?? '').localeCompare(second.group?.slug ?? '')
  );
}

const tableRows = computed<ModelRow[]>(() =>
  stackByKey(
    (models.value ?? []).flatMap(publicationsOf).filter(isShownByGroupFilter),
    (publication) => publication.model.id,
    comparePublications,
  ),
);
const stackedModelIds = computed(
  () => new Set(tableRows.value.filter(isStack).map((stack) => stack.key)),
);
const expandedStacks = ref<Record<string, boolean>>({});

function publishedName(publication: Publication): string {
  return publication.group
    ? publishedModelName(publication.group, publication.model.name)
    : publication.model.name;
}

function rowIdOf(row: ModelRow): string {
  if (isStack(row)) return `stack:${row.key}`;
  return `${row.model.id}:${row.group?.id ?? 'ungrouped'}`;
}

function modelOf(row: ModelRow): ModelSummary {
  return isStack(row) ? row.members[0].model : row.model;
}

function isStackMember(row: ModelRow): boolean {
  return !isStack(row) && stackedModelIds.value.has(row.model.id);
}

function isLeadRow(row: ModelRow): boolean {
  return !isStackMember(row);
}

const columns: DataTableColumn<ModelRow>[] = [
  {
    id: 'model',
    header: 'Model',
    enableHiding: false,
    accessorFn: (row) =>
      isStack(row)
        ? modelSearchText(modelOf(row), row.members.map(publishedName).join('\n'))
        : modelSearchText(row.model, publishedName(row)),
  },
  { id: 'kind', header: 'Kind' },
  { id: 'routes', header: 'Routes' },
  { id: 'status', header: 'Status' },
  actionsColumn(),
];

const isCreateDialogOpen = ref(false);
const newModelName = ref('');
const newModelDisplayName = ref('');
const newModelKind = ref<ModelKind>('chat');
const newModelGroupIds = ref<string[]>([]);
const isSaving = ref(false);
const dialogError = ref('');

function openCreateDialog(): void {
  newModelName.value = '';
  newModelDisplayName.value = '';
  newModelKind.value = 'chat';
  newModelGroupIds.value = [];
  dialogError.value = '';
  isCreateDialogOpen.value = true;
}

function createProblem(): string | null {
  const nameProblem = modelNameProblem(newModelName.value);
  if (nameProblem) return nameProblem;
  const displayProblem = displayNameProblem(newModelDisplayName.value);
  if (displayProblem) return displayProblem;
  return newModelGroupIds.value.length === 0 ? 'Pick at least one Group.' : null;
}

async function createModel(): Promise<void> {
  const problem = createProblem();
  if (problem) {
    dialogError.value = problem;
    return;
  }
  isSaving.value = true;
  dialogError.value = '';
  try {
    const created = await $dashboardApi<Pick<ModelDetail, 'id' | 'name'>>('/models', {
      method: 'POST',
      body: {
        name: newModelName.value,
        displayName: displayNameValue(newModelDisplayName.value),
        kind: newModelKind.value,
        groupIds: newModelGroupIds.value,
      },
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
      search-placeholder="Search name or group"
      :columns="columns"
      v-model:expanded="expandedStacks"
      :rows="tableRows"
      :get-row-id="rowIdOf"
      :get-sub-rows="(row) => (isStack(row) ? row.members : undefined)"
      :row-class="
        (row) => ({ 'model-table__row--open': isStack(row) && expandedStacks[rowIdOf(row)] })
      "
      :is-loading="isLoading"
      :error="loadError"
      :refresh="refresh"
      :filters="activeFilters"
      @clear-filters="groupFilter = []"
    >
      <template #filters>
        <div class="data-table-filter">
          <span class="data-table-filter__label" aria-hidden="true">Group</span>
          <AppMultiSelect
            v-model="groupFilter"
            :options="groupFilterOptions"
            label="Filter by Group"
            placeholder="All Groups"
            noun="Groups"
          />
        </div>
      </template>
      <template #cell-model="{ row, isExpanded, toggleExpanded }">
        <div v-if="isStack(row)" class="table-entity model-table__entity">
          <span class="key-icon"><Boxes :size="15" /></span>
          <span class="model-table__name">
            <NuxtLink class="model-table__open" :to="`/models/${row.key}`">{{
              modelLabelOf(modelOf(row)).label
            }}</NuxtLink>
            <code v-if="modelOf(row).displayName" class="cell-note">{{ modelOf(row).name }}</code>
            <button
              class="cell-note model-table__open"
              type="button"
              :aria-expanded="isExpanded"
              @click="toggleExpanded"
            >
              {{ isExpanded ? 'Hide' : 'Show' }} {{ row.members.length }} Groups
            </button>
          </span>
        </div>
        <div v-else-if="isStackMember(row)" class="table-entity model-table__entity">
          <span class="model-table__title">
            <code>{{ publishedName(row) }}</code>
            <CopyIconButton :text="publishedName(row)" label="model name" />
          </span>
          <span class="cell-note">{{ row.group?.name }}</span>
        </div>
        <div v-else class="table-entity model-table__entity">
          <span class="key-icon"><Boxes :size="15" /></span>
          <span class="model-table__name">
            <span class="model-table__title">
              <NuxtLink class="model-table__open" :to="`/models/${row.model.id}`">{{
                modelLabelOf(row.model, publishedName(row)).label
              }}</NuxtLink>
              <CopyIconButton :text="publishedName(row)" label="model name" />
              <span
                v-if="row.group === null"
                class="status-badge status-badge--warn status-badge--small"
                >No group</span
              >
            </span>
            <code v-if="row.model.displayName" class="cell-note">{{ publishedName(row) }}</code>
            <span v-if="row.group" class="cell-note">{{ row.group.name }}</span>
          </span>
        </div>
      </template>
      <template #cell-kind="{ row }">
        <template v-if="isLeadRow(row)">{{ MODEL_KIND_LABELS[modelOf(row).kind] }}</template>
      </template>
      <template #cell-routes="{ row }">
        <template v-if="isLeadRow(row)">
          <span class="tabular">{{ modelOf(row).routeCount }}</span>
          <span v-if="modelOf(row).routeCount === 0" class="status-badge status-badge--warn"
            >No Routes</span
          >
        </template>
      </template>
      <template #cell-status="{ row }">
        <span
          v-if="isLeadRow(row)"
          class="status-badge"
          :class="modelOf(row).isEnabled ? 'status-badge--good' : 'status-badge--warn'"
          >{{ modelOf(row).isEnabled ? 'Enabled' : 'Disabled' }}</span
        >
      </template>
      <template #cell-actions="{ row }">
        <div v-if="isLeadRow(row)" class="row-actions">
          <button class="row-action" @click="toggleModel(modelOf(row))">
            <Power :size="14" /> {{ modelOf(row).isEnabled ? 'Disable' : 'Enable' }}
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
      description='Clients send "<group slug>/<name>" as the model, once for each of its Groups.'
    >
      <form class="form" @submit.prevent="createModel">
        <label class="field"
          ><span class="field__label">Name</span
          ><input v-model="newModelName" class="text-input" autocomplete="off" required
        /></label>
        <p v-if="modelNameProblem(newModelName)" class="form__error" role="alert">
          {{ modelNameProblem(newModelName) }}
        </p>
        <label class="field"
          ><span class="field__label">Display name (optional)</span
          ><input
            v-model="newModelDisplayName"
            class="text-input"
            autocomplete="off"
            placeholder="e.g. DeepSeek V4.1 Flash"
        /></label>
        <p v-if="displayNameProblem(newModelDisplayName)" class="form__error" role="alert">
          {{ displayNameProblem(newModelDisplayName) }}
        </p>
        <p v-else class="form__hint">
          Shown only in the dashboard. Clients still send the name above. Up to
          {{ DISPLAY_NAME_MAX_LENGTH }} characters.
        </p>
        <ModelGroupPicker v-model="newModelGroupIds" />
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
