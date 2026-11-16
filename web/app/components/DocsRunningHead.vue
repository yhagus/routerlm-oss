<script setup lang="ts">
import { PanelLeft, Search } from "@lucide/vue";

/**
 * The docs' header, full width over the contents and the sheet: the brand
 * and where the reader is (Client API, page counter) on the left, search in
 * the middle, the reader's settings on the right. On a phone the settings
 * move into the contents drawer, which opens from the button on the left.
 */
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
