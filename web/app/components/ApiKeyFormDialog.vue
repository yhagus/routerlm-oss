<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api';
import {
  type ApiKeySummary,
  type CreatedApiKey,
  endOfLocalDay,
  localDateOf,
  MAX_REQUEST_RATE,
  MAX_SPEND_LIMIT_USD,
  type ModelChoice,
  pickedLabels,
} from '~/lib/api-keys';
import { allowedGroupOptions, type ModelGroup } from '~/lib/modelGroups';
import { formatCost } from '~/lib/usage';

const props = defineProps<{
  apiKey?: ApiKeySummary;
  modelChoices: ModelChoice[] | undefined;
  isLoadingModelChoices: boolean;
}>();
const isOpen = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ created: [apiKey: CreatedApiKey]; updated: [apiKey: ApiKeySummary] }>();

const { $dashboardApi } = useNuxtApp();
const { data: groups, status: groupsStatus } = useDashboardApi<ModelGroup[]>('/model-groups', {
  key: 'model-groups',
});
const isLoadingGroups = computed(() => groupsStatus.value === 'pending' && !groups.value);

const name = ref('');
const expiryDate = ref('');
const allowedModelIds = ref<string[]>([]);
const allowedModelGroupIds = ref<string[]>([]);
const directUpstreamAccess = ref(false);
const spendLimit = ref('');
const requestRate = ref('');
const isSaving = ref(false);
const error = ref('');

const isEdit = computed(() => props.apiKey !== undefined);
const today = new Date().toLocaleDateString('en-CA');

watch(
  isOpen,
  (open) => {
    if (!open) return;
    name.value = props.apiKey?.name ?? '';
    expiryDate.value = localDateOf(props.apiKey?.expiresAt ?? null);
    allowedModelIds.value = props.apiKey?.allowedModels.map((model) => model.id) ?? [];
    allowedModelGroupIds.value = props.apiKey?.allowedModelGroups.map((group) => group.id) ?? [];
    directUpstreamAccess.value = props.apiKey?.directUpstreamAccess ?? false;
    spendLimit.value = limitText(props.apiKey?.spendLimit ?? null);
    requestRate.value = limitText(props.apiKey?.requestRate ?? null);
    error.value = '';
  },
  { immediate: true },
);

const modelOptions = computed(() => {
  const options = (props.modelChoices ?? []).map((model) => ({
    label: model.name,
    value: model.id,
  }));
  const offered = new Set(options.map((option) => option.value));
  const deleted = (props.apiKey?.allowedModels ?? [])
    .filter((model) => !offered.has(model.id))
    .map((model) => ({ label: model.name ?? 'Deleted Model', value: model.id }));
  return [...options, ...deleted];
});

const groupOptions = computed(() =>
  allowedGroupOptions(groups.value, props.apiKey?.allowedModelGroups ?? []),
);

const allowedSummary = computed(() => {
  const models = pickedLabels(allowedModelIds.value, modelOptions.value, 'Deleted Model');
  const groupNames = pickedLabels(allowedModelGroupIds.value, groupOptions.value, 'Deleted group');
  const names = [...models, ...groupNames.map((group) => `every Model in ${group}`)];
  if (names.length === 0) return 'Every Model, including ones added later.';
  return `Only ${names.join(', ')}.`;
});

function limitText(limit: number | null): string {
  return limit === null ? '' : String(limit);
}

function limitValue(text: string): number | null {
  return text === '' ? null : Number(text);
}

const spentNote = computed(() =>
  props.apiKey ? `${formatCost(props.apiKey.spent)} spent so far.` : '',
);

function sameIds(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((id) => second.includes(id));
}

const changes = computed(() => {
  const original = props.apiKey;
  if (!original) return {};
  const fields: {
    name?: string;
    expiresAt?: string | null;
    allowedModelIds?: string[];
    allowedModelGroupIds?: string[];
    directUpstreamAccess?: boolean;
    spendLimit?: number | null;
    requestRate?: number | null;
  } = {};
  if (name.value.trim() !== original.name) fields.name = name.value.trim();
  if (expiryDate.value !== localDateOf(original.expiresAt)) {
    fields.expiresAt = expiryDate.value ? endOfLocalDay(expiryDate.value) : null;
  }
  const originalIds = original.allowedModels.map((model) => model.id);
  if (!sameIds(allowedModelIds.value, originalIds)) fields.allowedModelIds = allowedModelIds.value;
  const originalGroupIds = original.allowedModelGroups.map((group) => group.id);
  if (!sameIds(allowedModelGroupIds.value, originalGroupIds)) {
    fields.allowedModelGroupIds = allowedModelGroupIds.value;
  }
  if (directUpstreamAccess.value !== original.directUpstreamAccess) {
    fields.directUpstreamAccess = directUpstreamAccess.value;
  }
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
  error.value = '';
  try {
    if (props.apiKey) {
      const updated = await $dashboardApi<ApiKeySummary>(`/api-keys/${props.apiKey.id}`, {
        method: 'PATCH',
        body: changes.value,
      });
      emit('updated', updated);
    } else {
      const created = await $dashboardApi<CreatedApiKey>('/api-keys', {
        method: 'POST',
        body: {
          name: name.value,
          expiresAt: expiryDate.value ? endOfLocalDay(expiryDate.value) : null,
          allowedModelIds: allowedModelIds.value,
          allowedModelGroupIds: allowedModelGroupIds.value,
          directUpstreamAccess: directUpstreamAccess.value,
          spendLimit: limitValue(spendLimit.value),
          requestRate: limitValue(requestRate.value),
        },
      });
      emit('created', created);
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
    <form class="form form--full-width-selects" @submit.prevent="submit">
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
          >A key allowed a Group can call every Model currently in it. Leave both Models and Groups
          empty to allow every Model. {{ allowedSummary }}</span
        >
      </div>
      <div class="field">
        <label class="check-field"
          ><input v-model="directUpstreamAccess" type="checkbox" /> Direct Upstream Access</label
        >
        <span class="field__note"
          >On top of its allowed Models, the key can also call every usable Upstream Model as
          <code>upstream/&lt;provider&gt;/&lt;model&gt;</code>.</span
        >
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
          {{ apiKey ? 'Save changes' : 'Create API Key' }}
        </button>
      </div>
    </form>
  </AppDialog>
</template>
