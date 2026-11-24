<script setup lang="ts">
import { Plus } from "@lucide/vue";
import type { Provider, UpstreamModel } from "~/lib/upstream";

useHead({ title: "Upstream Models" });

const {
  data: upstreamModels,
  status: upstreamModelsStatus,
  error: loadError,
  refresh: refreshUpstreamModels,
} = useDashboardApi<UpstreamModel[]>("/upstream-models");
const {
  data: providers,
  status: providersStatus,
  error: providersError,
  refresh: refreshProviders,
} = useDashboardApi<Provider[]>("/providers");

async function refresh(): Promise<void> {
  await Promise.all([refreshUpstreamModels(), refreshProviders()]);
}

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

    <UpstreamModelBrowser
      ref="browser"
      :providers="providers ?? []"
      :upstream-models="upstreamModels ?? []"
      :refresh="refresh"
      :is-loading="isLoading"
      :error="loadError || providersError"
    />
  </div>
</template>
