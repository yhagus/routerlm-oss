<script setup lang="ts">
import { computed } from "vue";

const { docsRoot, t } = useDocsLocale();
const { page, status } = useDocsPage();
const { currentPage, pageCounter } = useDocsContents();

useSeoMeta({
  title: () => (page.value ? `${page.value.title} · ${t("docs")}` : t("docs")),
  description: () => page.value?.description,
});

const pageBody = computed(() => {
  if (!page.value) return null;
  const [firstNode, ...otherNodes] = page.value.body.value;
  const opensWithTitle = Array.isArray(firstNode) && firstNode[0] === "h1";
  return opensWithTitle
    ? { ...page.value, body: { ...page.value.body, value: otherNodes } }
    : page.value;
});

const articleCounters = computed(
  () => `ds-page ${currentPage.value?.number ?? 0} ds-section ds-subsection ds-figure`,
);
</script>

<template>
  <div class="ds-sheet">
    <p v-if="status === 'pending'" class="ds-sheet__loading">{{ t("loading") }}</p>
    <div v-else-if="status === 'error'" class="ds-title ds-title--error">
      <p class="ds-title__message">{{ t("loadFailed") }}</p>
    </div>
    <template v-else-if="page && pageBody">
      <DocsTitleBlock
        :title="page.title"
        :description="page.description"
        :endpoint="page.endpoint"
        :page-counter="pageCounter"
        :markdown="page.rawbody"
      />
      <article class="ds-article" :style="{ counterReset: articleCounters }">
        <ContentRenderer :value="pageBody" class="ds-prose" />
      </article>
      <DocsPager />
    </template>
    <div v-else class="ds-title ds-title--error">
      <p class="ds-title__message">{{ t("notFound") }}</p>
      <NuxtLink :to="docsRoot" class="ds-title__recovery">{{ t("goToOverview") }}</NuxtLink>
    </div>
  </div>
</template>
