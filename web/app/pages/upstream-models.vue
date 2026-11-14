<script setup lang="ts">
import { Plus } from "@lucide/vue";
import type { Provider, UpstreamModel } from "~/lib/upstream";

useHead({ title: "Upstream Models" });

const [
  { data: upstreamModels, error: loadError, refresh },
  { data: providers, error: providersError },
] = await Promise.all([
  useDashboardApi<UpstreamModel[]>("/upstream-models"),
  useDashboardApi<Provider[]>("/providers"),
]);

const browser = useTemplateRef<{ openCreate: () => void }>("browser");
</script>

<template>
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

  <div v-if="loadError || providersError" class="panel empty-state empty-state--standalone">
    <strong>Couldn't load Upstream Models.</strong
    ><span>Check that the backend is running, then reload the page.</span>
  </div>
  <UpstreamModelBrowser
    v-else
    ref="browser"
    :providers="providers ?? []"
    :upstream-models="upstreamModels ?? []"
    :refresh="refresh"
  />
</template>
