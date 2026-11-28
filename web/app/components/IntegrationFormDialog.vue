<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api';
import { type ModelChoice, pickedLabels } from '~/lib/api-keys';
import type { CreatedIntegration, IntegrationSummary } from '~/lib/integrations';
import { allowedGroupOptions, type ModelGroup } from '~/lib/modelGroups';
import { modelOptionOf } from '~/lib/routing';

const props = defineProps<{
  integration?: IntegrationSummary;
  modelChoices: ModelChoice[] | undefined;
  isLoadingModelChoices: boolean;
}>();
const isOpen = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
  created: [integration: CreatedIntegration];
  updated: [integration: IntegrationSummary];
}>();

const { $dashboardApi } = useNuxtApp();
const { data: groups, status: groupsStatus } = useDashboardApi<ModelGroup[]>('/model-groups', {
  key: 'model-groups',
});
const isLoadingGroups = computed(() => groupsStatus.value === 'pending' && !groups.value);

const name = ref('');
const allowedModelIds = ref<string[]>([]);
const allowedModelGroupIds = ref<string[]>([]);
const directUpstreamAccess = ref(false);
const isSaving = ref(false);
const error = ref('');

const isEdit = computed(() => props.integration !== undefined);

watch(
  isOpen,
  (open) => {
    if (!open) return;
    name.value = props.integration?.name ?? '';
    allowedModelIds.value = props.integration?.allowedModels.map((model) => model.id) ?? [];
    allowedModelGroupIds.value =
      props.integration?.allowedModelGroups.map((group) => group.id) ?? [];
    directUpstreamAccess.value = props.integration?.directUpstreamAccess ?? false;
    error.value = '';
  },
  { immediate: true },
);

const modelOptions = computed(() => {
  const options = (props.modelChoices ?? []).map(modelOptionOf);
  const offered = new Set(options.map((option) => option.value));
  const deleted = (props.integration?.allowedModels ?? [])
    .filter((model) => !offered.has(model.id))
    .map((model) => ({ label: model.name ?? 'Deleted Model', value: model.id }));
  return [...options, ...deleted];
});

const groupOptions = computed(() =>
  allowedGroupOptions(groups.value, props.integration?.allowedModelGroups ?? []),
);

const allowedSummary = computed(() => {
  const models = pickedLabels(allowedModelIds.value, modelOptions.value, 'Deleted Model');
  const groupNames = pickedLabels(allowedModelGroupIds.value, groupOptions.value, 'Deleted group');
  const names = [...models, ...groupNames.map((group) => `every Model in ${group}`)];
  if (names.length === 0) return 'Its API Keys may use every Model, including ones added later.';
  return `Its API Keys may use only ${names.join(', ')}.`;
});

function sameIds(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((id) => second.includes(id));
}

const changes = computed(() => {
  const original = props.integration;
  if (!original) return {};
  const fields: {
    name?: string;
    allowedModelIds?: string[];
    allowedModelGroupIds?: string[];
    directUpstreamAccess?: boolean;
  } = {};
  if (name.value.trim() !== original.name) fields.name = name.value.trim();
  const originalIds = original.allowedModels.map((model) => model.id);
  if (!sameIds(allowedModelIds.value, originalIds)) fields.allowedModelIds = allowedModelIds.value;
  const originalGroupIds = original.allowedModelGroups.map((group) => group.id);
  if (!sameIds(allowedModelGroupIds.value, originalGroupIds)) {
    fields.allowedModelGroupIds = allowedModelGroupIds.value;
  }
  if (directUpstreamAccess.value !== original.directUpstreamAccess) {
    fields.directUpstreamAccess = directUpstreamAccess.value;
  }
  return fields;
});
const hasChanges = computed(() => Object.keys(changes.value).length > 0);

async function submit(): Promise<void> {
  isSaving.value = true;
  error.value = '';
  try {
    if (props.integration) {
      const updated = await $dashboardApi<IntegrationSummary>(
        `/integrations/${props.integration.id}`,
        { method: 'PATCH', body: changes.value },
      );
      emit('updated', updated);
    } else {
      const created = await $dashboardApi<CreatedIntegration>('/integrations', {
        method: 'POST',
        body: {
          name: name.value,
          allowedModelIds: allowedModelIds.value,
          allowedModelGroupIds: allowedModelGroupIds.value,
          directUpstreamAccess: directUpstreamAccess.value,
        },
      });
      emit('created', created);
    }
  } catch (caught) {
    error.value = apiErrorMessage(
      caught,
      isEdit.value ? "Couldn't save the Integration." : "Couldn't create the Integration.",
    );
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    :title="integration ? `Edit ${integration.name}` : 'Create Integration'"
    :description="
      integration
        ? 'Changes apply to the next request made with any of its API Keys. Its Integration Secret stays the same.'
        : 'One Integration per outside application, so each can be limited, rotated or disabled alone.'
    "
  >
    <form class="form form--full-width-selects" @submit.prevent="submit">
      <label class="field"
        ><span class="field__label">Name</span
        ><input
          v-model="name"
          class="text-input"
          type="text"
          maxlength="100"
          placeholder="e.g. Reseller portal"
          required
      /></label>
      <div class="field">
        <span class="field__label">Allowed Models</span>
        <AppMultiSelect
          v-model="allowedModelIds"
          :options="modelOptions"
          label="Allowed Models"
          placeholder="All Models"
          noun="Models"
          match="all"
          empty-text="No Models yet"
        />
      </div>
      <div class="field">
        <span class="field__label">Allowed Groups</span>
        <AppMultiSelect
          v-model="allowedModelGroupIds"
          :options="groupOptions"
          label="Allowed Groups"
          placeholder="No Groups"
          noun="Groups"
          match="all"
          empty-text="No Groups yet"
        />
        <span v-if="isLoadingModelChoices || isLoadingGroups" class="field__note"
          >Loading Models and Groups…</span
        >
        <span v-else class="field__note"
          >Its API Keys may call every Model currently in an allowed Group. Leave both Models and
          Groups empty to allow every Model. {{ allowedSummary }}</span
        >
      </div>
      <div class="field">
        <label class="check-field"
          ><input v-model="directUpstreamAccess" type="checkbox" /> Direct Upstream Access</label
        >
        <span class="field__note"
          >Its Customer keys may be granted it, so they can also call every usable Upstream Model as
          <code>upstream/&lt;provider&gt;/&lt;model&gt;</code>.</span
        >
      </div>
      <p v-if="error" class="form__error" role="alert">{{ error }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="isOpen = false">Cancel</button>
        <button
          class="button button--primary"
          type="submit"
          :disabled="isSaving || isLoadingModelChoices || (isEdit && !hasChanges)"
        >
          {{ integration ? 'Save changes' : 'Create Integration' }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
