<script setup lang="ts">
import { Boxes, CloudOff } from "@lucide/vue";

defineProps<{ isLogEmpty: boolean }>();

const {
  kindLabel,
  source,
  modelOptions,
  modelsError,
  isLoadingModels,
  upstreamModelOptions,
  upstreamError,
  isLoadingUpstream,
  providerLogosBySlug,
  selectedProvider,
  selectedUpstreamModel,
  selectedProviderAccounts,
  modelDetail,
  modelDetailState,
} = useInjectedPlaygroundTarget();
</script>

<template>
  <template v-if="source === 'model'">
    <EmptyState v-if="modelsError" :icon="CloudOff" tone="error">
      <strong>Couldn't load the Models.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>
    <EmptyState v-else-if="!isLoadingModels && modelOptions.length === 0" :icon="Boxes">
      <strong>No enabled {{ kindLabel }} Model to try.</strong
      ><span
        >Create or enable one on the <NuxtLink to="/models">Models</NuxtLink> page, or send to an
        Upstream Model directly.</span
      >
    </EmptyState>
    <div v-else-if="isLoadingModels" class="route-preview__loading">
      <AppSpinner />
    </div>
    <PlaygroundRoutePreview
      v-else-if="isLogEmpty"
      :model="modelDetail"
      :is-loading="modelDetailState === 'loading'"
      :has-error="modelDetailState === 'failed'"
      :provider-logos="providerLogosBySlug"
    />
  </template>
  <template v-else>
    <EmptyState v-if="upstreamError" :icon="CloudOff" tone="error">
      <strong>Couldn't load the Upstream Models.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>
    <EmptyState v-else-if="!isLoadingUpstream && upstreamModelOptions.length === 0" :icon="Boxes">
      <strong>No enabled {{ kindLabel }} Upstream Model to try.</strong
      ><span
        >Enable a Provider and one of its models on the
        <NuxtLink to="/upstream-models">Upstream Models</NuxtLink> page.</span
      >
    </EmptyState>
    <div v-else-if="isLoadingUpstream" class="route-preview__loading">
      <AppSpinner />
    </div>
    <PlaygroundUpstreamPreview
      v-else-if="isLogEmpty && selectedProvider && selectedUpstreamModel"
      :provider="selectedProvider"
      :upstream-model="selectedUpstreamModel"
      :accounts="selectedProviderAccounts"
    />
  </template>
</template>
