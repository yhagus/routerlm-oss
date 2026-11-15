<script setup lang="ts">
import { CloudOff, Plus } from "@lucide/vue";
import type { Provider, UpstreamModel } from "~/lib/upstream";

useHead({ title: "Upstream Models" });

const {
  data: upstreamModels,
  status: upstreamModelsStatus,
  error: loadError,
  refresh,
} = useDashboardApi<UpstreamModel[]>("/upstream-models");
const {
  data: providers,
  status: providersStatus,
  error: providersError,
} = useDashboardApi<Provider[]>("/providers");

/** The table needs both lists: models to list, Providers to name them. */
const isLoading = computed(
  () =>
    (upstreamModelsStatus.value === "pending" && !upstreamModels.value) ||
    (providersStatus.value === "pending" && !providers.value),
);

const browser = useTemplateRef<{ openCreate: () => void }>("browser");
</script>

<template>
  <div class="page-view">
    <PageHeading
      title="Upstream Models"
      description="Models as each Provider names and sells them, with their Capabilities, limits and prices per million tokens."
    >
      <button
        class="button button--primary"
        type="button"
        :disabled="!providers?.length"
        @click="browser?.openCreate()"
      >
        <Plus :size="14" /> Add Upstream Model
      </button>
    </PageHeading>

    <EmptyState
      v-if="loadError || providersError"
      class="panel empty-state--standalone"
      :icon="CloudOff"
      tone="error"
    >
      <strong>Couldn't load Upstream Models.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>
    <UpstreamModelBrowser
      v-else
      ref="browser"
      :providers="providers ?? []"
      :upstream-models="upstreamModels ?? []"
      :refresh="refresh"
      :is-loading="isLoading"
    />
  </div>
</template>
