<script setup lang="ts">
import "@fontsource-variable/jetbrains-mono";
import "~/assets/css/docs.css";
import { X } from "@lucide/vue";
import { nextTick, shallowRef, useTemplateRef, watch } from "vue";
import type { DocsLocale } from "~/lib/docsMessages";

/**
 * The client docs: a full-width header, the numbered contents as a flat
 * column on the canvas, and every page on one sheet beside it. The
 * dashboard's tokens and shapes, in a structure of its own (see
 * assets/css/docs.css). On a phone the contents open as a drawer.
 */
const route = useRoute();
const { locale, t } = useDocsLocale();

const search = useTemplateRef<{ open: () => void }>("search");
const contentsCloseButton = useTemplateRef<HTMLButtonElement>("contentsCloseButton");
const isContentsOpen = shallowRef(false);
let contentsOpenedFrom: HTMLElement | null = null;

function openContents(): void {
  contentsOpenedFrom =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  isContentsOpen.value = true;
  void nextTick(() => contentsCloseButton.value?.focus());
}

function closeContents(): void {
  if (!isContentsOpen.value) return;
  isContentsOpen.value = false;
  contentsOpenedFrom?.focus();
  contentsOpenedFrom = null;
}

watch(
  () => route.path,
  () => (isContentsOpen.value = false),
);

function handleContentsKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeContents();
}

// Search engines and readers learn of the page's other language; English is the default.
const origin = useRequestURL().origin;
const pageUrlIn = (target: DocsLocale): string =>
  `${origin}${docsPathIn(target, docsPagePathOf(route.path))}`;
useHead({
  htmlAttrs: { lang: locale },
  link: () => [
    { rel: "alternate", hreflang: "en", href: pageUrlIn("en") },
    { rel: "alternate", hreflang: "id", href: pageUrlIn("id") },
    { rel: "alternate", hreflang: "x-default", href: pageUrlIn("en") },
  ],
});
</script>

<template>
  <div class="datasheet">
    <DocsRunningHead @open-search="search?.open()" @open-contents="openContents" />
    <div class="datasheet__body">
      <div v-if="isContentsOpen" class="datasheet__scrim" @click="closeContents" />
      <aside
        class="datasheet__contents"
        :class="{ 'datasheet__contents--open': isContentsOpen }"
        @keydown="handleContentsKeydown"
      >
        <div class="datasheet__sheet-head">
          <span class="datasheet__sheet-title">{{ t("contents") }}</span>
          <button
            ref="contentsCloseButton"
            class="icon-button"
            type="button"
            :aria-label="t('closeContents')"
            @click="closeContents"
          >
            <X :size="18" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
        <DocsContents @section-picked="closeContents" />
        <div class="datasheet__sheet-settings">
          <DocsLanguageSwitch />
          <DocsThemeToggle />
          <DocsAccountLink />
        </div>
      </aside>
      <main class="datasheet__main">
        <slot />
      </main>
    </div>
    <DocsSearch ref="search" />
  </div>
</template>
