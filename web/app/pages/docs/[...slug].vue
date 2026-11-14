<script setup lang="ts">
import { computed } from "vue";

definePageMeta({ layout: "docs" });

const route = useRoute();
// "/docs/" and "/docs" are the same page.
const pagePath = computed(() => route.path.replace(/\/+$/, ""));

const { data: page, status } = await useAsyncData(
  () => `docs-page-${pagePath.value}`,
  () => queryCollection("docs").path(pagePath.value).first(),
);

useSeoMeta({
  title: () => (page.value ? `${page.value.title} · Docs` : "Docs"),
  description: () => page.value?.description,
});
</script>

<template>
  <p v-if="status === 'pending'" class="docs-status">Loading…</p>
  <div v-else-if="status === 'error'" class="docs-status">
    <p>This page couldn't be loaded. Reload to try again.</p>
  </div>
  <article v-else-if="page" class="panel docs-article">
    <ContentRenderer :value="page" />
  </article>
  <div v-else class="docs-status">
    <p>There is no documentation page at this address.</p>
    <NuxtLink to="/docs">Go to the overview</NuxtLink>
  </div>
</template>
