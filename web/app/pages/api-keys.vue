<script setup lang="ts">
import { Ban, CloudOff, Copy, KeyRound, Plus } from "@lucide/vue";
import { computed, ref } from "vue";
import { apiErrorMessage } from "~/lib/api";
import {
  type ApiKeySummary,
  apiKeyStatus,
  type CreatedApiKey,
  endOfLocalDay,
  type ModelChoice,
} from "~/lib/api-keys";

useHead({ title: "API Keys" });

type CreateDialog = { step: "form" } | { step: "created"; apiKey: CreatedApiKey };

const STATUS_LABELS = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const {
  data: apiKeys,
  error: loadError,
  status: apiKeysStatus,
  refresh,
} = useDashboardApi<ApiKeySummary[]>("/api-keys");
const { data: modelChoices, status: modelChoicesStatus } =
  useDashboardApi<ModelChoice[]>("/api-keys/model-choices");

/** Only the first load shows placeholders; a refresh keeps the current rows until it lands. */
const isLoadingApiKeys = computed(() => apiKeysStatus.value === "pending" && !apiKeys.value);
// Creating before the choices arrive would silently allow every Model.
const isLoadingModelChoices = computed(
  () => modelChoicesStatus.value === "pending" && !modelChoices.value,
);

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, what <input type="date"> takes

function formatDate(value: string | null, whenNull: string): string {
  return value ? dateFormat.format(new Date(value)) : whenNull;
}

// Status is worked out once per load: a key that expires while the page is open shows it on the next refresh.
const rows = computed(() =>
  (apiKeys.value ?? []).map((apiKey) => ({ ...apiKey, status: apiKeyStatus(apiKey, Date.now()) })),
);

function allowedModelsLabel(apiKey: ApiKeySummary): string {
  if (apiKey.allowedModels.length === 0) return "All Models";
  return apiKey.allowedModels.map((model) => model.name ?? "Deleted Model").join(", ");
}

// Create

const createDialog = ref<CreateDialog | null>(null);
const newName = ref("");
const newExpiryDate = ref("");
const newAllowedModelIds = ref<string[]>([]);
const isCreating = ref(false);
const createError = ref("");
const isCreateOpen = computed({
  get: () => createDialog.value !== null,
  set: (isOpen) => {
    if (!isOpen) closeCreateDialog();
  },
});

function openCreateDialog(): void {
  newName.value = "";
  newExpiryDate.value = "";
  newAllowedModelIds.value = [];
  createError.value = "";
  createDialog.value = { step: "form" };
}

function closeCreateDialog(): void {
  createDialog.value = null;
}

async function createApiKey(): Promise<void> {
  isCreating.value = true;
  createError.value = "";
  try {
    const created = await $dashboardApi<CreatedApiKey>("/api-keys", {
      method: "POST",
      body: {
        name: newName.value,
        expiresAt: newExpiryDate.value ? endOfLocalDay(newExpiryDate.value) : null,
        allowedModelIds: newAllowedModelIds.value,
      },
    });
    createDialog.value = { step: "created", apiKey: created };
    await refresh();
  } catch (error) {
    createError.value = apiErrorMessage(error, "Couldn't create the API Key.");
  } finally {
    isCreating.value = false;
  }
}

async function copyKey(key: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(key);
    showToast("API Key copied");
  } catch {
    showToast("Couldn't copy. Select the key and copy it yourself.");
  }
}

function selectAll(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) event.target.select();
}

// Revoke

const revoking = ref<ApiKeySummary | null>(null);
const isRevoking = ref(false);
const revokeError = ref("");
const isRevokeOpen = computed({
  get: () => revoking.value !== null,
  set: (isOpen) => {
    if (!isOpen) revoking.value = null;
  },
});

function startRevoke(apiKey: ApiKeySummary): void {
  revoking.value = apiKey;
  revokeError.value = "";
}

async function revokeApiKey(): Promise<void> {
  const apiKey = revoking.value;
  if (!apiKey) return;
  isRevoking.value = true;
  revokeError.value = "";
  try {
    await $dashboardApi(`/api-keys/${apiKey.id}/revoke`, { method: "POST" });
    showToast(`Revoked ${apiKey.name}`);
    revoking.value = null;
    await refresh();
  } catch (error) {
    revokeError.value = apiErrorMessage(error, "Couldn't revoke the API Key.");
  } finally {
    isRevoking.value = false;
  }
}
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="API Keys"
      description="Credentials client applications use to call the gateway."
    >
      <button class="button button--primary" type="button" @click="openCreateDialog">
        <Plus :size="14" /> Create API Key
      </button>
    </PageHeading>

    <section class="panel table-panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Key id</th>
              <th>Allowed Models</th>
              <th>Created</th>
              <th>Created by</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="apiKey in rows" :key="apiKey.id">
              <td>
                <div class="table-entity">
                  <span class="key-icon"><KeyRound :size="15" /></span
                  ><strong>{{ apiKey.name }}</strong>
                </div>
              </td>
              <td class="tabular">rlm_{{ apiKey.keyId }}_…</td>
              <td>{{ allowedModelsLabel(apiKey) }}</td>
              <td class="tabular">{{ formatDate(apiKey.createdAt, "—") }}</td>
              <td>{{ apiKey.createdBy?.email ?? "—" }}</td>
              <td class="tabular">{{ formatDate(apiKey.expiresAt, "Never") }}</td>
              <td>
                <span
                  class="status-badge"
                  :class="apiKey.status === 'active' ? 'status-badge--good' : 'status-badge--bad'"
                  >{{ STATUS_LABELS[apiKey.status] }}</span
                >
              </td>
              <td>
                <div class="row-actions">
                  <button v-if="!apiKey.revokedAt" class="row-action" @click="startRevoke(apiKey)">
                    <Ban :size="14" /> Revoke
                  </button>
                </div>
              </td>
            </tr>
            <LoadingRow v-if="isLoadingApiKeys" :columns="8" />
          </tbody>
        </table>
        <EmptyState v-if="loadError" :icon="CloudOff" tone="error">
          <strong>Couldn't load API Keys.</strong
          ><span>Check that the backend is running, then reload the page.</span>
        </EmptyState>
        <EmptyState v-else-if="!isLoadingApiKeys && rows.length === 0" :icon="KeyRound">
          <strong>No API Keys yet.</strong
          ><span>Create one for each client application that calls the gateway.</span>
        </EmptyState>
      </div>
    </section>

    <AppDialog
      v-if="createDialog?.step === 'form'"
      v-model:open="isCreateOpen"
      title="Create API Key"
      description="The key is shown once, right after you create it. Only its hash is stored."
    >
      <form class="form" @submit.prevent="createApiKey">
        <label class="field"
          ><span class="field__label">Name</span
          ><input
            v-model="newName"
            class="text-input"
            type="text"
            maxlength="100"
            placeholder="e.g. Support bot"
            required
        /></label>
        <label class="field"
          ><span class="field__label">Expires on (optional)</span
          ><input v-model="newExpiryDate" class="text-input" type="date" :min="today"
        /></label>
        <fieldset class="field model-choices">
          <legend class="field__label">Allowed Models</legend>
          <p class="model-choices__hint">Leave all unticked to allow every Model.</p>
          <label v-for="model in modelChoices" :key="model.id" class="model-choices__option"
            ><input v-model="newAllowedModelIds" type="checkbox" :value="model.id" />{{
              model.name
            }}</label
          >
          <p v-if="isLoadingModelChoices" class="model-choices__hint">Loading Models…</p>
          <p v-else-if="modelChoices?.length === 0" class="model-choices__hint">
            No Models exist yet, so this key will allow every Model.
          </p>
        </fieldset>
        <p v-if="createError" class="form__error" role="alert">{{ createError }}</p>
        <div class="dialog__actions">
          <button class="button" type="button" @click="closeCreateDialog">Cancel</button>
          <button
            class="button button--primary"
            type="submit"
            :disabled="isCreating || isLoadingModelChoices"
          >
            Create API Key
          </button>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      v-if="createDialog?.step === 'created'"
      v-model:open="isCreateOpen"
      :title="`${createDialog.apiKey.name} created`"
      description="Copy the key now. It won't be shown again; if it's lost, revoke it and create another."
    >
      <div class="key-reveal">
        <input
          class="text-input key-reveal__value"
          type="text"
          :value="createDialog.apiKey.key"
          aria-label="API Key"
          readonly
          @focus="selectAll"
        />
        <button class="button" type="button" @click="copyKey(createDialog.apiKey.key)">
          <Copy :size="14" /> Copy
        </button>
      </div>
      <div class="dialog__actions">
        <button class="button button--primary" type="button" @click="closeCreateDialog">
          Done
        </button>
      </div>
    </AppDialog>

    <AppDialog
      v-if="revoking"
      v-model:open="isRevokeOpen"
      title="Revoke API Key"
      :description="`Clients using ${revoking.name} are refused from now on. This can't be undone.`"
    >
      <p v-if="revokeError" class="form__error" role="alert">{{ revokeError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="revoking = null">Cancel</button>
        <button
          class="button button--danger"
          type="button"
          :disabled="isRevoking"
          @click="revokeApiKey"
        >
          Revoke API Key
        </button>
      </div>
    </AppDialog>
  </div>
</template>
