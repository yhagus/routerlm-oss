<script setup lang="ts">
import { PanelLeft, Search } from "@lucide/vue";

const emit = defineEmits<{ openSearch: []; openContents: [] }>();

const { docsRoot, t } = useDocsLocale();
const { currentPage, pageCount, pageCounter } = useDocsContents();
const searchShortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";
</script>

<template>
  <header class="ds-head">
    <button
      class="icon-button ds-head__narrow"
      type="button"
      :aria-label="t('openContents')"
      @click="emit('openContents')"
    >
      <PanelLeft :size="18" :stroke-width="1.8" aria-hidden="true" />
    </button>
    <div class="ds-head__identity">
      <NuxtLink :to="docsRoot" class="brand ds-head__brand">
        <span class="brand__mark">R</span><span>router<span>lm</span></span>
      </NuxtLink>
      <span class="ds-head__tag">{{ t("docs") }}</span>
      <span class="ds-head__wide">{{ t("clientApi") }}</span>
      <span v-if="pageCounter && currentPage" class="ds-head__counter ds-head__wide">
        <span aria-hidden="true">{{ pageCounter }}</span>
        <span class="sr-only">{{
          t("pageOf", { current: String(currentPage.number), total: String(pageCount) })
        }}</span>
      </span>
    </div>
    <button class="ds-search-trigger" type="button" @click="emit('openSearch')">
      <Search :size="15" :stroke-width="1.8" aria-hidden="true" />
      <span>{{ t("searchPlaceholder") }}</span>
      <kbd>{{ searchShortcut }}</kbd>
    </button>
    <div class="ds-head__tools">
      <button
        class="icon-button ds-head__narrow"
        type="button"
        :aria-label="t('search')"
        @click="emit('openSearch')"
      >
        <Search :size="18" :stroke-width="1.8" aria-hidden="true" />
      </button>
      <div class="ds-head__settings">
        <DocsLanguageSwitch />
        <DocsThemeToggle />
        <DocsAccountLink />
      </div>
    </div>
  </header>
</template>
