<script setup lang="ts">
import { Plus } from '@lucide/vue';
import { apiErrorMessage } from '~/lib/api';
import { GROUP_SLUG_HINT, GROUP_SLUG_PATTERN, type ModelGroup } from '~/lib/modelGroups';

const groupIds = defineModel<string[]>({ required: true });

const { $dashboardApi } = useNuxtApp();
const {
  data: groups,
  error: loadError,
  refresh,
} = useDashboardApi<ModelGroup[]>('/model-groups', { key: 'model-groups' });
const groupOptions = computed(() =>
  (groups.value ?? []).map((group) => ({
    label: `${group.name} (${group.slug})`,
    value: group.id,
  })),
);

const isCreating = ref(false);
const isSaving = ref(false);
const createError = ref('');
const draft = useGroupDraft();
const { name: draftName, slug: draftSlug } = draft;
const slugPattern = new RegExp(`^${GROUP_SLUG_PATTERN}$`);

function startCreating(): void {
  draft.reset();
  createError.value = '';
  isCreating.value = true;
}

async function createGroup(): Promise<void> {
  if (draftName.value.trim() === '' || !slugPattern.test(draftSlug.value)) {
    createError.value = `Give the Group a name and a slug. ${GROUP_SLUG_HINT}`;
    return;
  }
  isSaving.value = true;
  createError.value = '';
  try {
    const created = await $dashboardApi<ModelGroup>('/model-groups', {
      method: 'POST',
      body: { name: draftName.value, slug: draftSlug.value },
    });
    await refresh();
    groupIds.value = [...groupIds.value, created.id];
    isCreating.value = false;
  } catch (error) {
    createError.value = apiErrorMessage(error, "Couldn't create the Group.");
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="field">
    <span class="field__label">Groups</span>
    <div class="group-picker__row">
      <AppMultiSelect
        v-model="groupIds"
        :options="groupOptions"
        label="Groups"
        placeholder="Pick at least one Group"
        noun="Groups"
        match="all"
        empty-text="No Groups yet. Create one."
      />
      <button v-if="!isCreating" class="button" type="button" @click="startCreating">
        <Plus :size="14" /> New group
      </button>
    </div>
    <p v-if="loadError" class="form__error" role="alert">Couldn't load the Groups.</p>
    <div v-if="isCreating" class="group-picker__create">
      <label class="field"
        ><span class="field__label">Group name</span
        ><input
          v-model="draftName"
          class="text-input"
          autocomplete="off"
          @keydown.enter.prevent="createGroup"
      /></label>
      <label class="field"
        ><span class="field__label">Group slug</span
        ><input
          v-model="draftSlug"
          class="text-input"
          autocomplete="off"
          :pattern="GROUP_SLUG_PATTERN"
          @keydown.enter.prevent="createGroup"
      /></label>
      <div class="group-picker__actions">
        <button class="button" type="button" @click="isCreating = false">Cancel</button>
        <button
          class="button button--primary"
          type="button"
          :disabled="isSaving"
          @click="createGroup"
        >
          Add group
        </button>
      </div>
      <p v-if="createError" class="form__error" role="alert">{{ createError }}</p>
    </div>
  </div>
</template>
