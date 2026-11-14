<script setup lang="ts">
import { Cpu, Pencil, Plus, Power, Trash2 } from "@lucide/vue";
import { computed, ref } from "vue";
import { apiErrorMessage } from "~/lib/api";
import {
  CAPABILITIES,
  type Capability,
  numberField,
  optionalNumber,
  type Provider,
  type UpstreamModel,
} from "~/lib/upstream";

useHead({ title: "Upstream Models" });

type UpstreamModelDialog =
  | { kind: "create" }
  | { kind: "edit"; upstreamModel: UpstreamModel }
  | { kind: "delete"; upstreamModel: UpstreamModel };

const ALL_PROVIDERS = "";

const { $dashboardApi } = useNuxtApp();
const { showToast } = useToast();
const [
  { data: upstreamModels, error: loadError, refresh },
  { data: providers, error: providersError },
] = await Promise.all([
  useDashboardApi<UpstreamModel[]>("/upstream-models"),
  useDashboardApi<Provider[]>("/providers"),
]);

const providerNameById = computed(
  () => new Map((providers.value ?? []).map((provider) => [provider.id, provider.name])),
);
const providerOptions = computed(() =>
  (providers.value ?? []).map((provider) => ({ label: provider.name, value: provider.id })),
);
const providerFilter = ref(ALL_PROVIDERS);
const providerFilterOptions = computed(() => [
  { label: "All Providers", value: ALL_PROVIDERS },
  ...providerOptions.value,
]);
const visibleUpstreamModels = computed(() =>
  (upstreamModels.value ?? []).filter(
    (upstreamModel) =>
      providerFilter.value === ALL_PROVIDERS || upstreamModel.providerId === providerFilter.value,
  ),
);

const integerFormat = new Intl.NumberFormat();
const priceFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});
function formatPrice(price: number | null): string {
  return price === null ? "—" : priceFormat.format(price);
}

const dialog = ref<UpstreamModelDialog | null>(null);
const isDialogOpen = computed({
  get: () => dialog.value !== null,
  set: (isOpen) => {
    if (!isOpen) dialog.value = null;
  },
});
const isSaving = ref(false);
const dialogError = ref("");

/** Number inputs hold a number, or "" when empty. */
type NumberInput = number | string;

interface UpstreamModelForm {
  providerId: string;
  upstreamModelId: string;
  capabilities: Capability[];
  contextSize: NumberInput;
  maxOutputTokens: NumberInput;
  inputPrice: NumberInput;
  outputPrice: NumberInput;
  cacheReadPrice: NumberInput;
  cacheWritePrice: NumberInput;
}

const form = ref<UpstreamModelForm>(emptyForm());

function emptyForm(): UpstreamModelForm {
  return {
    providerId: providerFilter.value || (providerOptions.value[0]?.value ?? ""),
    upstreamModelId: "",
    capabilities: [],
    contextSize: "",
    maxOutputTokens: "",
    inputPrice: "",
    outputPrice: "",
    cacheReadPrice: "",
    cacheWritePrice: "",
  };
}

function formFor(upstreamModel: UpstreamModel): UpstreamModelForm {
  return {
    providerId: upstreamModel.providerId,
    upstreamModelId: upstreamModel.upstreamModelId,
    capabilities: [...upstreamModel.capabilities],
    contextSize: upstreamModel.contextSize,
    maxOutputTokens: numberField(upstreamModel.maxOutputTokens),
    inputPrice: numberField(upstreamModel.inputPrice),
    outputPrice: numberField(upstreamModel.outputPrice),
    cacheReadPrice: numberField(upstreamModel.cacheReadPrice),
    cacheWritePrice: numberField(upstreamModel.cacheWritePrice),
  };
}

function openDialog(next: UpstreamModelDialog): void {
  dialog.value = next;
  dialogError.value = "";
  if (next.kind === "create") form.value = emptyForm();
  if (next.kind === "edit") form.value = formFor(next.upstreamModel);
}

async function saveUpstreamModel(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === "delete") return;
  isSaving.value = true;
  dialogError.value = "";
  const fields = {
    upstreamModelId: form.value.upstreamModelId,
    capabilities: form.value.capabilities,
    contextSize: optionalNumber(form.value.contextSize),
    maxOutputTokens: optionalNumber(form.value.maxOutputTokens),
    inputPrice: optionalNumber(form.value.inputPrice),
    outputPrice: optionalNumber(form.value.outputPrice),
    cacheReadPrice: optionalNumber(form.value.cacheReadPrice),
    cacheWritePrice: optionalNumber(form.value.cacheWritePrice),
  };
  try {
    if (current.kind === "create") {
      await $dashboardApi("/upstream-models", {
        method: "POST",
        body: { providerId: form.value.providerId, ...fields },
      });
      showToast(`Added ${fields.upstreamModelId}`);
    } else {
      await $dashboardApi(`/upstream-models/${current.upstreamModel.id}`, {
        method: "PATCH",
        body: fields,
      });
      showToast(`Saved ${fields.upstreamModelId}`);
    }
    dialog.value = null;
    await refresh();
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't save the Upstream Model.");
  } finally {
    isSaving.value = false;
  }
}

async function deleteUpstreamModel(upstreamModel: UpstreamModel): Promise<void> {
  isSaving.value = true;
  dialogError.value = "";
  try {
    await $dashboardApi(`/upstream-models/${upstreamModel.id}`, { method: "DELETE" });
    showToast(`Deleted ${upstreamModel.upstreamModelId}`);
    dialog.value = null;
    await refresh();
  } catch (error) {
    dialogError.value = apiErrorMessage(error, "Couldn't delete the Upstream Model.");
  } finally {
    isSaving.value = false;
  }
}

async function toggleUpstreamModel(upstreamModel: UpstreamModel): Promise<void> {
  try {
    await $dashboardApi(`/upstream-models/${upstreamModel.id}`, {
      method: "PATCH",
      body: { isEnabled: !upstreamModel.isEnabled },
    });
    showToast(
      `${upstreamModel.isEnabled ? "Disabled" : "Enabled"} ${upstreamModel.upstreamModelId}`,
    );
    await refresh();
  } catch (error) {
    showToast(apiErrorMessage(error, `Couldn't update ${upstreamModel.upstreamModelId}.`));
  }
}
</script>

<template>
  <PageHeading
    title="Upstream Models"
    description="Models as each Provider names and sells them, with their Capabilities, limits and prices per million tokens."
  >
    <AppSelect
      v-model="providerFilter"
      :options="providerFilterOptions"
      aria-label="Filter by Provider"
    />
    <button
      class="button button--primary"
      type="button"
      :disabled="providerOptions.length === 0"
      @click="openDialog({ kind: 'create' })"
    >
      <Plus :size="14" /> Add Upstream Model
    </button>
  </PageHeading>

  <section class="panel table-panel">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Upstream Model</th>
            <th>Provider</th>
            <th>Capabilities</th>
            <th>Context</th>
            <th>Max output</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache read</th>
            <th>Cache write</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="upstreamModel in visibleUpstreamModels" :key="upstreamModel.id">
            <td>
              <div class="table-entity">
                <span class="key-icon"><Cpu :size="15" /></span
                ><strong>{{ upstreamModel.upstreamModelId }}</strong>
              </div>
            </td>
            <td>{{ providerNameById.get(upstreamModel.providerId) ?? "—" }}</td>
            <td>{{ upstreamModel.capabilities.join(", ") || "—" }}</td>
            <td class="tabular">{{ integerFormat.format(upstreamModel.contextSize) }}</td>
            <td class="tabular">
              {{
                upstreamModel.maxOutputTokens === null
                  ? "—"
                  : integerFormat.format(upstreamModel.maxOutputTokens)
              }}
            </td>
            <td class="tabular">{{ formatPrice(upstreamModel.inputPrice) }}</td>
            <td class="tabular">{{ formatPrice(upstreamModel.outputPrice) }}</td>
            <td class="tabular">{{ formatPrice(upstreamModel.cacheReadPrice) }}</td>
            <td class="tabular">{{ formatPrice(upstreamModel.cacheWritePrice) }}</td>
            <td>
              <span
                class="status-badge"
                :class="upstreamModel.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
                >{{ upstreamModel.isEnabled ? "Enabled" : "Disabled" }}</span
              >
            </td>
            <td>
              <div class="row-actions">
                <button class="row-action" @click="openDialog({ kind: 'edit', upstreamModel })">
                  <Pencil :size="14" /> Edit
                </button>
                <button class="row-action" @click="toggleUpstreamModel(upstreamModel)">
                  <Power :size="14" /> {{ upstreamModel.isEnabled ? "Disable" : "Enable" }}
                </button>
                <button class="row-action" @click="openDialog({ kind: 'delete', upstreamModel })">
                  <Trash2 :size="14" /> Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="loadError || providersError" class="empty-state">
        <strong>Couldn't load Upstream Models.</strong
        ><span>Check that the backend is running, then reload the page.</span>
      </div>
      <div v-else-if="visibleUpstreamModels.length === 0" class="empty-state">
        <strong>No Upstream Models here yet.</strong
        ><span>Add one, or run <code>bun run db:seed</code> to load the Catalog.</span>
      </div>
    </div>
  </section>

  <AppDialog
    v-if="dialog && dialog.kind !== 'delete'"
    v-model:open="isDialogOpen"
    wide
    :title="
      dialog.kind === 'create'
        ? 'Add Upstream Model'
        : `Edit ${dialog.upstreamModel.upstreamModelId}`
    "
    description="Prices are USD per million tokens. Leave a price empty when the Provider doesn't publish it; Cost then stays empty."
  >
    <form class="form" @submit.prevent="saveUpstreamModel">
      <div class="form__grid">
        <div class="field">
          <span class="field__label">Provider</span>
          <AppSelect
            v-if="dialog.kind === 'create'"
            v-model="form.providerId"
            :options="providerOptions"
            aria-label="Provider"
          />
          <input
            v-else
            class="text-input"
            :value="providerNameById.get(form.providerId)"
            disabled
          />
        </div>
        <label class="field"
          ><span class="field__label">Name at the Provider</span
          ><input v-model="form.upstreamModelId" class="text-input" required
        /></label>
      </div>
      <fieldset class="check-group">
        <legend class="field__label">Capabilities</legend>
        <label v-for="capability in CAPABILITIES" :key="capability" class="check-field"
          ><input v-model="form.capabilities" type="checkbox" :value="capability" />
          {{ capability }}</label
        >
      </fieldset>
      <div class="form__grid">
        <label class="field"
          ><span class="field__label">Context size (tokens)</span
          ><input v-model="form.contextSize" class="text-input" type="number" min="1" required
        /></label>
        <label class="field"
          ><span class="field__label">Max output (tokens)</span
          ><input v-model="form.maxOutputTokens" class="text-input" type="number" min="1"
        /></label>
        <label class="field"
          ><span class="field__label">Input price</span
          ><input v-model="form.inputPrice" class="text-input" type="number" min="0" step="any"
        /></label>
        <label class="field"
          ><span class="field__label">Output price</span
          ><input v-model="form.outputPrice" class="text-input" type="number" min="0" step="any"
        /></label>
        <label class="field"
          ><span class="field__label">Cache read price</span
          ><input v-model="form.cacheReadPrice" class="text-input" type="number" min="0" step="any"
        /></label>
        <label class="field"
          ><span class="field__label">Cache write price</span
          ><input
            v-model="form.cacheWritePrice"
            class="text-input"
            type="number"
            min="0"
            step="any"
        /></label>
      </div>
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="dialog = null">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ dialog.kind === "create" ? "Add Upstream Model" : "Save" }}
        </button>
      </div>
    </form>
  </AppDialog>

  <AppDialog
    v-if="dialog?.kind === 'delete'"
    v-model:open="isDialogOpen"
    title="Delete Upstream Model"
    :description="`${dialog.upstreamModel.upstreamModelId} is deleted. This can't be undone.`"
  >
    <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="dialog = null">Cancel</button>
      <button
        class="button button--danger"
        type="button"
        :disabled="isSaving"
        @click="deleteUpstreamModel(dialog.upstreamModel)"
      >
        Delete Upstream Model
      </button>
    </div>
  </AppDialog>
</template>
