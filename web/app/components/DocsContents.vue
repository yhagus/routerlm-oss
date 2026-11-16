<script setup lang="ts">
import { computed } from "vue";
import { pickHeading } from "~/composables/useActiveHeading";
import { formatPageNumber } from "~/composables/useDocsContents";

/**
 * The numbered contents: every page of the current language, and under the
 * current page its numbered sections, the one being read marked.
 */
const emit = defineEmits<{ sectionPicked: [] }>();

const { t } = useDocsLocale();
const { pages, isLoading, currentPage } = useDocsContents();
const { page } = useDocsPage();

/** The current page's h2 sections, each with the ids of its h3s. */
const sections = computed(() =>
  (page.value?.body.toc?.links ?? []).map((link) => ({
    id: link.id,
    text: link.text,
    childIds: (link.children ?? []).map((child) => child.id),
  })),
);
// The scroll-spy follows h3s too, so a link to one is held and scrolled to.
const headingIds = computed(() =>
  sections.value.flatMap((section) => [section.id, ...section.childIds]),
);
const activeHeadingId = useActiveHeading(headingIds);

function handleSectionClick(id: string): void {
  pickHeading(id);
  emit("sectionPicked");
}

function isActiveSection(section: { id: string; childIds: string[] }): boolean {
  const activeId = activeHeadingId.value;
  return activeId !== null && (section.id === activeId || section.childIds.includes(activeId));
}
</script>

<template>
  <nav class="ds-contents" :aria-label="t('contents')">
    <p class="ds-contents__label" aria-hidden="true">{{ t("contents") }}</p>
    <p v-if="isLoading" class="ds-contents__status">{{ t("loading") }}</p>
    <ol class="ds-contents__pages">
      <li v-for="entry in pages" :key="entry.path">
        <NuxtLink
          :to="entry.path"
          class="ds-contents__page"
          active-class=""
          exact-active-class="ds-contents__page--current"
        >
          <span class="ds-contents__number">{{ formatPageNumber(entry.number) }}</span>
          <span>{{ entry.title }}</span>
        </NuxtLink>
        <ol
          v-if="entry.path === currentPage?.path && sections.length > 0"
          class="ds-contents__sections"
        >
          <li v-for="(section, index) in sections" :key="section.id">
            <!-- Handled here rather than by the router, so picking the current hash again still scrolls. -->
            <a
              :href="`#${section.id}`"
              class="ds-contents__section"
              :class="{ 'ds-contents__section--active': isActiveSection(section) }"
              :aria-current="isActiveSection(section) ? 'location' : undefined"
              @click.prevent="handleSectionClick(section.id)"
            >
              <span class="ds-contents__number">{{ entry.number }}.{{ index + 1 }}</span>
              <span>{{ section.text }}</span>
            </a>
          </li>
        </ol>
      </li>
    </ol>
  </nav>
</template>
