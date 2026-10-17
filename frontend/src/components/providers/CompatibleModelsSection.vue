<script setup lang="ts">
// Port of v1 CompatibleModelsSection — manual add + import from the /models
// endpoint for OpenAI/Anthropic-compatible nodes.
import { computed, ref } from "vue";
import { api } from "@/lib/api";
import type { ProviderConnection } from "@/types/api";
import { getProviderCustomModelRows } from "@/lib/providerCustomModels";
import Button from "@/components/ui/button.vue";

const props = defineProps<{
  providerStorageAlias: string;
  providerDisplayAlias: string;
  modelAliases: Record<string, string>;
  customModels: Array<{
    id?: string;
    name?: string;
    providerAlias?: string;
    kind?: string;
    type?: string;
  }>;
  connections: ProviderConnection[];
  isAnthropic: boolean;
}>();
const emit = defineEmits<{
  addCustomModel: [modelId: string];
  deleteCustomModel: [modelId: string];
  deleteAlias: [alias: string];
}>();

const newModel = ref("");
const adding = ref(false);
const importing = ref(false);
const testingModelId = ref<string | null>(null);
const modelTestResults = ref<Record<string, "ok" | "error">>({});

const allModels = computed(() =>
  getProviderCustomModelRows({
    customModels: props.customModels,
    modelAliases: props.modelAliases,
    providerAlias: props.providerStorageAlias,
    type: "llm",
  }),
);
const canImport = computed(() =>
  props.connections.some((connection) => connection.isActive !== false),
);

async function handleTestModel(modelId: string) {
  if (testingModelId.value) return;
  testingModelId.value = modelId;
  try {
    const result = await api.models.test(
      `${props.providerStorageAlias}/${modelId}`,
      "llm",
    );
    modelTestResults.value = {
      ...modelTestResults.value,
      [modelId]: result.ok ? "ok" : "error",
    };
  } catch {
    modelTestResults.value = { ...modelTestResults.value, [modelId]: "error" };
  } finally {
    testingModelId.value = null;
  }
}

async function copyModel(modelId: string) {
  try {
    await navigator.clipboard?.writeText(
      `${props.providerDisplayAlias}/${modelId}`,
    );
  } catch {
    /* clipboard unavailable */
  }
}

async function handleAdd() {
  const modelId = newModel.value.trim();
  if (!modelId || adding.value) return;
  if (allModels.value.some((model) => model.id === modelId)) {
    window.alert("Model already exists for this provider.");
    return;
  }
  adding.value = true;
  try {
    await emit("addCustomModel", modelId);
    newModel.value = "";
  } finally {
    adding.value = false;
  }
}

async function handleImport() {
  if (importing.value) return;
  const activeConnection = props.connections.find(
    (connection) => connection.isActive !== false,
  );
  if (!activeConnection) return;
  importing.value = true;
  try {
    const data = await api.providers.models(activeConnection.id);
    const models =
      (
        data as unknown as {
          models?: Array<{ id?: string; name?: string; model?: string }>;
        }
      ).models ||
      (
        data as unknown as {
          data?: Array<{ id?: string; name?: string; model?: string }>;
        }
      ).data ||
      [];
    if (!models.length) {
      window.alert("No models returned from /models.");
      return;
    }
    let importedCount = 0;
    for (const model of models) {
      const modelId = model.id || model.name || model.model;
      if (!modelId) continue;
      if (allModels.value.some((entry) => entry.id === modelId)) continue;
      await emit("addCustomModel", String(modelId));
      importedCount += 1;
    }
    if (importedCount === 0) window.alert("No new models were added.");
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-muted-foreground">
      Add {{ isAnthropic ? "Anthropic" : "OpenAI" }}-compatible models manually
      or import them from the /models endpoint.
    </p>
    <div class="flex flex-wrap items-end gap-2">
      <div class="min-w-[240px] flex-1 space-y-1">
        <label
          for="new-compatible-model-input"
          class="mb-1 block text-xs text-muted-foreground"
          >Model ID</label
        >
        <input
          id="new-compatible-model-input"
          v-model="newModel"
          type="text"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          :placeholder="isAnthropic ? 'claude-3-opus-20240229' : 'gpt-4o'"
          @keydown.enter="handleAdd"
        />
      </div>
      <Button @click="handleAdd" :disabled="!newModel.trim() || adding">
        <span class="material-symbols-outlined text-sm">add</span
        >{{ adding ? "Adding..." : "Add" }}
      </Button>
      <Button
        variant="secondary"
        :disabled="!canImport || importing"
        @click="handleImport"
      >
        <span class="material-symbols-outlined text-sm">{{
          importing ? "progress_activity" : "download"
        }}</span
        >{{ importing ? "Importing..." : "Import from /models" }}
      </Button>
    </div>
    <p v-if="!canImport" class="text-xs text-muted-foreground">
      Add a connection to enable importing models.
    </p>
    <div v-if="allModels.length" class="flex flex-col gap-3">
      <div
        v-for="{ id, alias, source } in allModels"
        :key="`${source}-${providerStorageAlias}/${id}`"
        class="flex items-center gap-3 rounded-lg border p-3 hover:bg-sidebar/50"
        :class="
          modelTestResults[id] === 'ok'
            ? 'border-green-500/40'
            : modelTestResults[id] === 'error'
              ? 'border-red-500/40'
              : 'border-border'
        "
      >
        <span
          class="material-symbols-outlined text-base text-muted-foreground"
          :class="
            modelTestResults[id] === 'ok'
              ? 'text-green-500'
              : modelTestResults[id] === 'error'
                ? 'text-red-500'
                : ''
          "
          >{{
            modelTestResults[id] === "ok"
              ? "check_circle"
              : modelTestResults[id] === "error"
                ? "cancel"
                : "smart_toy"
          }}</span
        >
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ id }}</p>
          <div class="mt-1 flex items-center gap-1">
            <code
              class="rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
              >{{ providerDisplayAlias }}/{{ id }}</code
            >
            <button
              class="rounded p-0.5 text-muted-foreground hover:bg-sidebar hover:text-primary"
              title="Copy"
              @click="copyModel(id)"
            >
              <span class="material-symbols-outlined text-sm"
                >content_copy</span
              >
            </button>
            <button
              v-if="connections.length"
              class="rounded p-0.5 text-muted-foreground hover:bg-sidebar hover:text-primary"
              :disabled="testingModelId === id"
              :title="testingModelId === id ? 'Testing...' : 'Test'"
              @click="handleTestModel(id)"
            >
              <span
                class="material-symbols-outlined text-sm"
                :class="{ 'animate-spin': testingModelId === id }"
                >{{
                  testingModelId === id ? "progress_activity" : "science"
                }}</span
              >
            </button>
          </div>
        </div>
        <button
          class="rounded p-1 text-red-500 hover:bg-red-500/10"
          title="Remove model"
          @click="
            source === 'custom'
              ? emit('deleteCustomModel', id)
              : emit('deleteAlias', alias || '')
          "
        >
          <span class="material-symbols-outlined text-sm">delete</span>
        </button>
      </div>
    </div>
  </div>
</template>
