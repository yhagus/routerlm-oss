<script setup lang="ts">
import { apiErrorMessage } from "~/lib/api";
import {
  type ApiKeySummary,
  type CreatedApiKey,
  endOfLocalDay,
  localDateOf,
  type ModelChoice,
} from "~/lib/api-keys";
import { formatCost } from "~/lib/usage";

/**
 * Creates an API Key, or edits one's name, expiry, allowed Models, Spend Limit
 * and Request Rate. Only a key a User created is edited here. An edit
 * sends only the fields that changed, so an expired key's past expiry is never
 * sent back as if it were new.
 */
const props = defineProps<{
  /** The key to edit; absent to create one. */
  apiKey?: ApiKeySummary;
  modelChoices: ModelChoice[] | undefined;
  isLoadingModelChoices: boolean;
}>();
const isOpen = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ created: [apiKey: CreatedApiKey]; updated: [apiKey: ApiKeySummary] }>();

const { $dashboardApi } = useNuxtApp();

const name = ref("");
const expiryDate = ref("");
const allowedModelIds = ref<string[]>([]);
// NumberInput values: the plain number as text, "" for no limit.
const spendLimit = ref("");
const requestRate = ref("");
const isSaving = ref(false);
const error = ref("");

// The backend's bounds: spend_limit is numeric(18, 10), the rate an int32.
const MAX_SPEND_LIMIT_USD = 99_999_999;
const MAX_REQUEST_RATE = 2_147_483_647;

const isEdit = computed(() => props.apiKey !== undefined);
const today = new Date().toLocaleDateString("en-CA");

watch(
  isOpen,
  (open) => {
    if (!open) return;
    name.value = props.apiKey?.name ?? "";
    expiryDate.value = localDateOf(props.apiKey?.expiresAt ?? null);
    allowedModelIds.value = props.apiKey?.allowedModels.map((model) => model.id) ?? [];
    spendLimit.value = limitText(props.apiKey?.spendLimit ?? null);
    requestRate.value = limitText(props.apiKey?.requestRate ?? null);
    error.value = "";
  },
  { immediate: true },
);

/**
 * The Models offered, plus any deleted Model the key is still restricted to,
 * so an edit can drop it instead of silently keeping it.
 */
const modelOptions = computed(() => {
  const options = (props.modelChoices ?? []).map((model) => ({
    label: model.name,
    value: model.id,
  }));
  const offered = new Set(options.map((option) => option.value));
  const deleted = (props.apiKey?.allowedModels ?? [])
    .filter((model) => !offered.has(model.id))
    .map((model) => ({ label: model.name ?? "Deleted Model", value: model.id }));
  return [...options, ...deleted];
});

const allowedSummary = computed(() => {
  if (allowedModelIds.value.length === 0) return "Every Model, including ones added later.";
  const labels = new Map(modelOptions.value.map((option) => [option.value, option.label]));
  return `Only ${allowedModelIds.value.map((id) => labels.get(id) ?? "Deleted Model").join(", ")}.`;
});

function limitText(limit: number | null): string {
  return limit === null ? "" : String(limit);
}

function limitValue(text: string): number | null {
  return text === "" ? null : Number(text);
}

const spentNote = computed(() =>
  props.apiKey ? `${formatCost(props.apiKey.spent)} spent so far.` : "",
);

function sameIds(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((id) => second.includes(id));
}

/** The fields an edit changes; empty when nothing did. */
const changes = computed(() => {
  const original = props.apiKey;
  if (!original) return {};
  const fields: {
    name?: string;
    expiresAt?: string | null;
    allowedModelIds?: string[];
    spendLimit?: number | null;
    requestRate?: number | null;
  } = {};
  if (name.value.trim() !== original.name) fields.name = name.value.trim();
  if (expiryDate.value !== localDateOf(original.expiresAt)) {
    fields.expiresAt = expiryDate.value ? endOfLocalDay(expiryDate.value) : null;
  }
  const originalIds = original.allowedModels.map((model) => model.id);
  if (!sameIds(allowedModelIds.value, originalIds)) fields.allowedModelIds = allowedModelIds.value;
  if (spendLimit.value !== limitText(original.spendLimit)) {
    fields.spendLimit = limitValue(spendLimit.value);
  }
  if (requestRate.value !== limitText(original.requestRate)) {
    fields.requestRate = limitValue(requestRate.value);
  }
  return fields;
});
const hasChanges = computed(() => Object.keys(changes.value).length > 0);

async function submit(): Promise<void> {
  isSaving.value = true;
  error.value = "";
  try {
    if (props.apiKey) {
      const updated = await $dashboardApi<ApiKeySummary>(`/api-keys/${props.apiKey.id}`, {
        method: "PATCH",
        body: changes.value,
      });
      emit("updated", updated);
    } else {
      const created = await $dashboardApi<CreatedApiKey>("/api-keys", {
        method: "POST",
        body: {
          name: name.value,
          expiresAt: expiryDate.value ? endOfLocalDay(expiryDate.value) : null,
          allowedModelIds: allowedModelIds.value,
          spendLimit: limitValue(spendLimit.value),
          requestRate: limitValue(requestRate.value),
        },
      });
      emit("created", created);
    }
  } catch (caught) {
    error.value = apiErrorMessage(
      caught,
      isEdit.value ? "Couldn't save the API Key." : "Couldn't create the API Key.",
    );
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    :title="apiKey ? `Edit ${apiKey.name}` : 'Create API Key'"
    :description="
      apiKey
        ? 'Changes apply to the next request made with this key. The key itself stays the same.'
        : 'One key per client application, so each can be limited, rotated or revoked alone.'
    "
  >
    <form class="form api-key-form" @submit.prevent="submit">
      <label class="field"
        ><span class="field__label">Name</span
        ><input
          v-model="name"
          class="text-input"
          type="text"
          maxlength="100"
          placeholder="e.g. Support bot"
          required
      /></label>
      <div class="field">
        <span class="field__label">Expires on</span>
        <AppDateInput v-model="expiryDate" label="Expires on" :min="today" />
        <span class="field__note">Leave empty for a key that never expires.</span>
      </div>
      <div class="field">
        <span class="field__label">Allowed Models</span>
        <AppMultiSelect
          v-model="allowedModelIds"
          class="api-key-form__models"
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
      <label class="field"
        ><span class="field__label">Spend Limit</span
        ><NumberInput
          v-model="spendLimit"
          class="text-input"
          :min="0"
          :max="MAX_SPEND_LIMIT_USD"
          prefix="$"
          unit-label="US dollars"
          placeholder="No limit"
        /><span class="field__note"
          >The most Cost the key may run up. Leave empty for no limit. {{ spentNote }}</span
        ></label
      >
      <label class="field"
        ><span class="field__label">Request Rate</span
        ><NumberInput
          v-model="requestRate"
          class="text-input"
          whole
          :min="1"
          :max="MAX_REQUEST_RATE"
          suffix="/ min"
          unit-label="requests per minute"
          placeholder="No limit"
        /><span class="field__note"
          >The most requests per minute. Leave empty for no limit.</span
        ></label
      >
      <p v-if="error" class="form__error" role="alert">{{ error }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="isOpen = false">Cancel</button>
        <button
          class="button button--primary"
          type="submit"
          :disabled="isSaving || isLoadingModelChoices || (isEdit && !hasChanges)"
        >
          {{ apiKey ? "Save changes" : "Create API Key" }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
