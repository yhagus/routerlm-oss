<script setup lang="ts">
import { apiErrorMessage } from "~/lib/api";
import type { ModelChoice } from "~/lib/api-keys";
import type { CreatedIntegration, IntegrationSummary } from "~/lib/integrations";

const props = defineProps<{
  integration?: IntegrationSummary;
  modelChoices: ModelChoice[] | undefined;
  isLoadingModelChoices: boolean;
}>();
const isOpen = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{
  created: [integration: CreatedIntegration];
  updated: [integration: IntegrationSummary];
}>();

const { $dashboardApi } = useNuxtApp();

const name = ref("");
const allowedModelIds = ref<string[]>([]);
const isSaving = ref(false);
const error = ref("");

const isEdit = computed(() => props.integration !== undefined);

watch(
  isOpen,
  (open) => {
    if (!open) return;
    name.value = props.integration?.name ?? "";
    allowedModelIds.value = props.integration?.allowedModels.map((model) => model.id) ?? [];
    error.value = "";
  },
  { immediate: true },
);

const modelOptions = computed(() => {
  const options = (props.modelChoices ?? []).map((model) => ({
    label: model.name,
    value: model.id,
  }));
  const offered = new Set(options.map((option) => option.value));
  const deleted = (props.integration?.allowedModels ?? [])
    .filter((model) => !offered.has(model.id))
    .map((model) => ({ label: model.name ?? "Deleted Model", value: model.id }));
  return [...options, ...deleted];
});

const allowedSummary = computed(() => {
  if (allowedModelIds.value.length === 0) {
    return "Its API Keys may use every Model, including ones added later.";
  }
  const labels = new Map(modelOptions.value.map((option) => [option.value, option.label]));
  const names = allowedModelIds.value.map((id) => labels.get(id) ?? "Deleted Model").join(", ");
  return `Its API Keys may use only ${names}.`;
});

function sameIds(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((id) => second.includes(id));
}

const changes = computed(() => {
  const original = props.integration;
  if (!original) return {};
  const fields: { name?: string; allowedModelIds?: string[] } = {};
  if (name.value.trim() !== original.name) fields.name = name.value.trim();
  const originalIds = original.allowedModels.map((model) => model.id);
  if (!sameIds(allowedModelIds.value, originalIds)) fields.allowedModelIds = allowedModelIds.value;
  return fields;
});
const hasChanges = computed(() => Object.keys(changes.value).length > 0);

async function submit(): Promise<void> {
  isSaving.value = true;
  error.value = "";
  try {
    if (props.integration) {
      const updated = await $dashboardApi<IntegrationSummary>(
        `/integrations/${props.integration.id}`,
        { method: "PATCH", body: changes.value },
      );
      emit("updated", updated);
    } else {
      const created = await $dashboardApi<CreatedIntegration>("/integrations", {
        method: "POST",
        body: { name: name.value, allowedModelIds: allowedModelIds.value },
      });
      emit("created", created);
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
        <span v-if="isLoadingModelChoices" class="field__note">Loading Models…</span>
        <span v-else class="field__note">{{ allowedSummary }}</span>
      </div>
      <p v-if="error" class="form__error" role="alert">{{ error }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="isOpen = false">Cancel</button>
        <button
          class="button button--primary"
          type="submit"
          :disabled="isSaving || isLoadingModelChoices || (isEdit && !hasChanges)"
        >
          {{ integration ? "Save changes" : "Create Integration" }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
