<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import type { VisionAdapter } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import Badge from "@/components/ui/badge.vue";
import Modal from "@/components/ui/modal.vue";
import Select from "@/components/ui/select.vue";
import Combobox from "@/components/ui/combobox.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import { useNotificationStore } from "@/stores/notifications";
import { getCapabilitiesForModel } from "@/lib/providerCapabilities";
import { PROVIDER_META } from "@/lib/providerMeta";

const queryClient = useQueryClient();
const notices = useNotificationStore();

const adapters = useQuery({
  queryKey: ["vision-adapters"],
  queryFn: api.visionAdapters.list,
});

const showEditor = ref(false);
const editing = ref<VisionAdapter | null>(null);
const name = ref("");
const models = ref<string[]>([]);
// Model picker: choose a provider first, then its models are the only options.
const selectedProvider = ref("");
const selectedModel = ref("");

const catalog = useQuery({
  queryKey: ["models", "chat"],
  queryFn: () => api.models.list("chat"),
});
const catalogModels = computed(() => catalog.data.value?.data || []);

function providerLabel(id: string): string {
  return PROVIDER_META[id]?.name || id;
}

const providerOptions = computed(() => {
  const ids = new Set<string>();
  for (const entry of catalogModels.value) {
    if (entry.provider) ids.add(entry.provider);
  }
  return [...ids]
    .map((id) => ({ value: id, label: providerLabel(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const modelOptions = computed(() => {
  if (!selectedProvider.value) return [];
  return catalogModels.value
    .filter((entry) => entry.provider === selectedProvider.value)
    .map((entry) => ({
      value: entry.id,
      label: entry.name && entry.name !== entry.model ? `${entry.name} · ${entry.id}` : entry.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

// Reset the model when the provider changes so a stale cross-provider id can't be added.
watch(selectedProvider, () => {
  selectedModel.value = "";
});

function addSelectedModel() {
  const id = selectedModel.value.trim();
  if (!id || models.value.includes(id)) return;
  models.value.push(id);
  selectedModel.value = "";
}
const busy = ref(false);
const removeTarget = ref<VisionAdapter | null>(null);
const removing = ref(false);
const globalTarget = ref<VisionAdapter | null>(null);

function openCreate() {
  editing.value = null;
  name.value = "";
  models.value = [];
  selectedProvider.value = "";
  selectedModel.value = "";
  showEditor.value = true;
}

function openEdit(adapter: VisionAdapter) {
  editing.value = adapter;
  name.value = adapter.name;
  models.value = Array.isArray(adapter.models) ? [...adapter.models] : [];
  selectedProvider.value = "";
  selectedModel.value = "";
  showEditor.value = true;
}

function removeModel(index: number) {
  models.value.splice(index, 1);
}

function moveModel(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= models.value.length) return;
  const temp = models.value[index];
  models.value[index] = models.value[target];
  models.value[target] = temp;
}

function modelHasVision(modelStr: string): boolean {
  const slash = modelStr.indexOf("/");
  const provider = slash > 0 ? modelStr.slice(0, slash) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
  const caps = getCapabilitiesForModel(provider, model);
  return caps.vision === true;
}

async function save() {
  if (!name.value.trim()) {
    notices.push("error", "Name is required.");
    return;
  }
  if (models.value.length === 0) {
    notices.push("error", "At least one model is required.");
    return;
  }
  busy.value = true;
  try {
    if (editing.value) {
      await api.visionAdapters.update(editing.value.id, {
        name: name.value.trim(),
        models: models.value,
      });
      notices.push("success", "Vision adapter updated.");
    } else {
      await api.visionAdapters.create({
        name: name.value.trim(),
        models: models.value,
      });
      notices.push("success", "Vision adapter created.");
    }
    await queryClient.invalidateQueries({ queryKey: ["vision-adapters"] });
    showEditor.value = false;
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not save vision adapter",
    );
  } finally {
    busy.value = false;
  }
}

async function confirmRemove() {
  if (!removeTarget.value) return;
  removing.value = true;
  try {
    await api.visionAdapters.remove(removeTarget.value.id);
    await queryClient.invalidateQueries({ queryKey: ["vision-adapters"] });
    notices.push("success", "Vision adapter removed.");
    removeTarget.value = null;
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error
        ? error.message
        : "Could not remove vision adapter",
    );
  } finally {
    removing.value = false;
  }
}

async function setGlobal(adapter: VisionAdapter) {
  if (adapter.isGlobal) {
    await api.visionAdapters.clearGlobal();
    notices.push("success", "Global vision adapter cleared.");
  } else {
    await api.visionAdapters.setGlobal(adapter.id);
    notices.push("success", `${adapter.name} set as global vision adapter.`);
  }
  await queryClient.invalidateQueries({ queryKey: ["vision-adapters"] });
}

function confirmSetGlobal(adapter: VisionAdapter) {
  if (adapter.isGlobal) {
    setGlobal(adapter);
    return;
  }
  globalTarget.value = adapter;
}

function executeSetGlobal() {
  if (globalTarget.value) {
    setGlobal(globalTarget.value);
    globalTarget.value = null;
  }
}

const adapterList = computed(() => adapters.data.value || []);
const globalAdapter = computed(
  () => adapterList.value.find((a) => a.isGlobal) || null,
);
</script>

<template>
  <div class="theme-v2 space-y-6">
    <PageHeader
      title="Vision Adapter"
      description="Named pools of vision-capable models. When a combo receives an image request and none of its models support vision, the global adapter's models are prepended as fallback candidates."
    >
      <template #actions>
        <Button @click="openCreate"><Plus class="size-4" />Add Adapter</Button>
      </template>
    </PageHeader>

    <div
      v-if="adapters.isPending.value"
      class="space-y-3"
      role="status"
      aria-label="Loading adapters"
    >
      <Card v-for="index in 2" :key="index" class="space-y-3 p-5">
        <Skeleton class="h-4 w-40" />
        <Skeleton class="h-3 w-20" />
        <Skeleton class="h-7 w-full" />
        <Skeleton class="h-7 w-full" />
      </Card>
    </div>

    <template v-else>
      <Card
        v-if="!adapterList.length"
        class="p-8 text-center text-muted-foreground"
      >
        <Eye class="mx-auto mb-3 size-8 text-muted-foreground/50" />
        <p class="text-sm">No vision adapters yet.</p>
        <p class="mt-1 text-xs">
          Create one to auto-route vision requests to capable models.
        </p>
      </Card>

      <div v-else class="space-y-3">
        <Card
          v-for="adapter in adapterList"
          :key="adapter.id"
          class="p-5"
          :class="adapter.isGlobal ? 'border-primary/40 bg-primary/5' : ''"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate font-medium">{{ adapter.name }}</h3>
                <Badge v-if="adapter.isGlobal">Global</Badge>
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ adapter.models.length }} model{{
                  adapter.models.length === 1 ? "" : "s"
                }}
              </p>
              <div v-if="adapter.models.length" class="mt-3 space-y-1">
                <div
                  v-for="(model, index) in adapter.models"
                  :key="index"
                  class="flex items-center gap-2 rounded px-2 py-1 text-xs"
                  :class="
                    modelHasVision(model) ? 'bg-muted/60' : 'bg-destructive/10'
                  "
                >
                  <span class="text-muted-foreground">#{{ index + 1 }}</span>
                  <code class="flex-1 truncate font-mono">{{ model }}</code>
                  <span
                    v-if="!modelHasVision(model)"
                    class="text-[10px] text-destructive"
                    title="This model may not support vision"
                    >no vision</span
                  >
                </div>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                class="size-9"
                :title="
                  adapter.isGlobal
                    ? 'Clear as global'
                    : 'Set as global fallback'
                "
                @click="confirmSetGlobal(adapter)"
              >
                <Star
                  class="size-4"
                  :class="
                    adapter.isGlobal
                      ? 'fill-primary text-primary'
                      : 'text-muted-foreground'
                  "
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="size-9"
                title="Edit"
                @click="openEdit(adapter)"
              >
                <span class="material-symbols-outlined text-sm">edit</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="size-9 text-destructive"
                title="Delete"
                @click="removeTarget = adapter"
              >
                <Trash2 class="size-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </template>

    <Modal
      :open="showEditor"
      :title="editing ? 'Edit Vision Adapter' : 'Add Vision Adapter'"
      @close="showEditor = false"
    >
      <form class="space-y-4" @submit.prevent="save">
        <div class="space-y-1.5">
          <Label for="va-name">Name</Label>
          <Input
            id="va-name"
            v-model="name"
            placeholder="e.g. Default Vision Pool"
          />
        </div>

        <div class="space-y-1.5">
          <Label>Models (ordered)</Label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <Select
              v-model="selectedProvider"
              :options="providerOptions"
              :placeholder="
                catalog.isPending.value ? 'Loading providers...' : 'Select provider'
              "
              :disabled="catalog.isPending.value"
              class="sm:w-48"
              aria-label="Provider"
            />
            <Combobox
              v-model="selectedModel"
              :options="modelOptions"
              :disabled="!selectedProvider"
              allow-custom
              placeholder="Select model"
              :search-placeholder="
                selectedProvider ? 'Search models...' : 'Pick a provider first'
              "
              empty-text="No models for this provider"
              class="min-w-0 flex-1"
              aria-label="Model"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              :disabled="!selectedModel.trim()"
              @click="addSelectedModel"
            >
              <Plus class="size-4" />Add
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Pick a provider, then one of its models. Models are tried in order;
            vision-capable models are recommended.
          </p>
        </div>

        <div v-if="models.length" class="space-y-1">
          <div
            v-for="(model, index) in models"
            :key="index"
            class="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span class="text-xs text-muted-foreground">#{{ index + 1 }}</span>
            <code class="flex-1 truncate font-mono text-xs">{{ model }}</code>
            <span
              v-if="!modelHasVision(model)"
              class="text-[10px] text-destructive"
              >no vision</span
            >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-6"
              :disabled="index === 0"
              @click="moveModel(index, -1)"
            >
              <ChevronUp class="size-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-6"
              :disabled="index === models.length - 1"
              @click="moveModel(index, 1)"
            >
              <ChevronDown class="size-3" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="size-6 text-destructive"
              @click="removeModel(index)"
            >
              <X class="size-3" />
            </Button>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" @click="showEditor = false"
            >Cancel</Button
          >
          <Button type="submit" :disabled="busy">
            {{
              busy ? "Saving..." : editing ? "Save changes" : "Create adapter"
            }}
          </Button>
        </div>
      </form>
    </Modal>

    <ConfirmModal
      :open="Boolean(removeTarget)"
      title="Delete Vision Adapter"
      :message="`Delete the vision adapter '${removeTarget?.name || ''}'? This action cannot be undone.`"
      confirm-text="Delete"
      :loading="removing"
      @confirm="confirmRemove"
      @close="removeTarget = null"
    />

    <ConfirmModal
      :open="Boolean(globalTarget)"
      title="Set as Global Vision Adapter"
      :message="`Set '${globalTarget?.name || ''}' as the global vision adapter? This will be used when any combo receives a vision request and none of its models support vision.`"
      confirm-text="Set as Global"
      @confirm="executeSetGlobal"
      @close="globalTarget = null"
    />
  </div>
</template>
