<script setup lang="ts">
import { Route } from "@lucide/vue";
import { computed } from "vue";
import type { PlaygroundSource } from "~/composables/usePlaygroundTarget";

const {
  source,
  modelName,
  modelOptions,
  modelsError,
  isLoadingModels,
  providerId,
  providerOptions,
  upstreamModelRowId,
  upstreamModelOptions,
  upstreamError,
  isLoadingUpstream,
} = useInjectedPlaygroundTarget();

const SOURCE_OPTIONS: { value: PlaygroundSource; label: string }[] = [
  { value: "model", label: "Model" },
  { value: "upstream", label: "Upstream Model" },
];

const modelPlaceholder = computed(() => {
  if (modelsError.value) return "Models unavailable";
  return isLoadingModels.value ? "Loading Models…" : "No enabled Model";
});
const providerPlaceholder = computed(() => {
  if (upstreamError.value) return "Providers unavailable";
  return isLoadingUpstream.value ? "Loading Providers…" : "No Provider";
});
</script>

<template>
  <div class="segmented bench-bar__source" role="group" aria-label="Send to">
    <button
      v-for="option in SOURCE_OPTIONS"
      :key="option.value"
      class="segmented__option"
      type="button"
      :aria-pressed="source === option.value"
      @click="source = option.value"
    >
      {{ option.label }}
    </button>
  </div>
  <AppSelect
    v-if="source === 'model'"
    v-model="modelName"
    class="bench-bar__model"
    :options="modelOptions"
    label="Model"
    searchable
    :placeholder="modelPlaceholder"
  >
    <template #leading><Route :size="14" :stroke-width="1.8" /></template>
  </AppSelect>
  <div v-else class="bench-bar__upstream">
    <AppSelect
      v-model="providerId"
      class="bench-bar__provider"
      :options="providerOptions"
      label="Provider"
      searchable
      :placeholder="providerPlaceholder"
    />
    <AppSelect
      v-model="upstreamModelRowId"
      class="bench-bar__model"
      :options="upstreamModelOptions"
      label="Upstream Model"
      searchable
      :placeholder="isLoadingUpstream ? 'Loading…' : 'No enabled Upstream Model'"
    />
  </div>
</template>
