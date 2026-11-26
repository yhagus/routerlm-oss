<script setup lang="ts">
import { FolderTree, Plus, Trash2 } from '@lucide/vue';
import { apiErrorMessage } from '~/lib/api';
import type { DataTableColumn } from '~/lib/dataTable';
import { GROUP_SLUG_HINT, GROUP_SLUG_PATTERN, type ModelGroup } from '~/lib/modelGroups';

useHead({ title: 'Groups' });

type GroupDialog = { mode: 'create' } | { mode: 'edit'; group: ModelGroup };

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: groups,
  status: groupsStatus,
  error: loadError,
  refresh,
} = useDashboardApi<ModelGroup[]>('/model-groups', { key: 'model-groups' });
const isLoading = computed(() => groupsStatus.value === 'pending' && !groups.value);

const columns: DataTableColumn<ModelGroup>[] = [
  { id: 'name', header: 'Name', enableHiding: false, accessorFn: (group) => group.name },
  { id: 'slug', header: 'Slug', accessorFn: (group) => group.slug },
  { id: 'models', header: 'Models' },
];

const dialog = ref<GroupDialog | null>(null);
const isDialogOpen = computed({
  get: () => dialog.value !== null,
  set: (isOpen) => {
    if (!isOpen) dialog.value = null;
  },
});
const draft = useGroupDraft();
const { name: draftName, slug: draftSlug } = draft;
const isSaving = ref(false);
const isConfirmingDelete = ref(false);
const dialogError = ref('');

const editedGroup = computed(() => (dialog.value?.mode === 'edit' ? dialog.value.group : null));
const isSlugChanged = computed(
  () => editedGroup.value !== null && draftSlug.value !== editedGroup.value.slug,
);

function openDialog(next: GroupDialog): void {
  draft.reset(next.mode === 'edit' ? next.group : undefined);
  dialogError.value = '';
  isConfirmingDelete.value = false;
  dialog.value = next;
}

function changedFields(group: ModelGroup): Partial<Pick<ModelGroup, 'name' | 'slug'>> {
  return {
    ...(draftName.value === group.name ? {} : { name: draftName.value }),
    ...(draftSlug.value === group.slug ? {} : { slug: draftSlug.value }),
  };
}

async function writeGroup(): Promise<string | null> {
  const group = editedGroup.value;
  if (!group) {
    const created = await $dashboardApi<ModelGroup>('/model-groups', {
      method: 'POST',
      body: { name: draftName.value, slug: draftSlug.value },
    });
    return `Created ${created.name}`;
  }
  const changes = changedFields(group);
  if (Object.keys(changes).length === 0) return null;
  await $dashboardApi(`/model-groups/${group.id}`, { method: 'PATCH', body: changes });
  return `Saved ${draftName.value}`;
}

async function saveGroup(): Promise<void> {
  isSaving.value = true;
  dialogError.value = '';
  try {
    const successMessage = await writeGroup();
    dialog.value = null;
    if (successMessage === null) return;
    showToast(successMessage);
    await refresh();
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't save the Group.");
  } finally {
    isSaving.value = false;
  }
}

async function deleteGroup(group: ModelGroup): Promise<void> {
  isSaving.value = true;
  dialogError.value = '';
  try {
    await $dashboardApi(`/model-groups/${group.id}`, { method: 'DELETE' });
    dialog.value = null;
    showToast(`Deleted ${group.name}`);
    await refresh();
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't delete the Group.");
    isConfirmingDelete.value = false;
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Groups"
      description='Clients send a Model as "<group slug>/<model name>", once for each of its Groups.'
    >
      <button class="button button--primary" type="button" @click="openDialog({ mode: 'create' })">
        <Plus :size="14" /> New group
      </button>
    </PageHeading>

    <DataTable
      table-id="groups"
      label="Groups"
      search-placeholder="Search name or slug"
      :columns="columns"
      :rows="groups ?? []"
      :get-row-id="(group) => group.id"
      :is-loading="isLoading"
      :error="loadError"
      :refresh="refresh"
    >
      <template #cell-name="{ row: group }">
        <div class="table-entity model-table__entity">
          <span class="key-icon"><FolderTree :size="15" /></span>
          <button
            class="model-table__open"
            type="button"
            @click="openDialog({ mode: 'edit', group })"
          >
            {{ group.name }}
          </button>
        </div>
      </template>
      <template #cell-slug="{ row: group }"><code>{{ group.slug }}</code></template>
      <template #cell-models="{ row: group }">
        <NuxtLink class="tabular" :to="{ path: '/models', query: { group: group.slug } }">{{
          group.modelCount
        }}</NuxtLink>
      </template>
      <template #empty>
        <EmptyState :icon="FolderTree">
          <strong>No Groups yet.</strong
          ><span>Create one, then add Models to it so clients can send its slug.</span>
        </EmptyState>
      </template>
    </DataTable>

    <AppDialog
      v-if="dialog"
      v-model:open="isDialogOpen"
      :title="editedGroup ? `Edit ${editedGroup.name}` : 'New group'"
      description='Clients send each of its Models as "<slug>/<model name>".'
    >
      <form class="form" @submit.prevent="saveGroup">
        <label class="field"
          ><span class="field__label">Name</span
          ><input v-model="draftName" class="text-input" autocomplete="off" required
        /></label>
        <label class="field"
          ><span class="field__label">Slug</span
          ><input
            v-model="draftSlug"
            class="text-input"
            autocomplete="off"
            :pattern="GROUP_SLUG_PATTERN"
            required
        /></label>
        <p class="form__hint">{{ GROUP_SLUG_HINT }}</p>
        <p v-if="editedGroup && isSlugChanged" class="form__warning" role="note">
          Clients sending "{{ editedGroup.slug }}/&lt;model&gt;" will get an unknown-model error
          until they switch to the new slug.
        </p>
        <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
        <div v-if="editedGroup && isConfirmingDelete" class="dialog__actions">
          <span class="form__warning">Delete {{ editedGroup.name }}?</span>
          <button class="button" type="button" @click="isConfirmingDelete = false">Keep</button>
          <button
            class="button button--danger"
            type="button"
            :disabled="isSaving"
            @click="deleteGroup(editedGroup)"
          >
            Delete group
          </button>
        </div>
        <div v-else class="dialog__actions">
          <button
            v-if="editedGroup"
            class="button"
            type="button"
            :disabled="isSaving"
            @click="isConfirmingDelete = true"
          >
            <Trash2 :size="14" /> Delete
          </button>
          <button class="button" type="button" @click="dialog = null">Cancel</button>
          <button class="button button--primary" type="submit" :disabled="isSaving">
            {{ editedGroup ? 'Save' : 'Create group' }}
          </button>
        </div>
      </form>
    </AppDialog>
  </div>
</template>
