<script setup lang="ts">
import { Search, X } from '@lucide/vue';
import { useEventListener } from '@vueuse/core';
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue';
import { pickHeading } from '~/composables/useActiveHeading';
import { formatPageNumber } from '~/composables/useDocsContents';
import type { DocsLocale } from '~/lib/docsMessages';
import { firstMatchIndexOf, type SearchRow, type Section, searchSections } from '~/lib/docsSearch';

const { locale, collection, t } = useDocsLocale();
const { pages } = useDocsContents();
const { withGatewayUrl } = useGatewayUrl();
const route = useRoute();

const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const input = useTemplateRef<HTMLInputElement>('input');
const query = shallowRef('');
const highlightedIndex = shallowRef(0);
let returnFocusTo: HTMLElement | null = null;

type IndexState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sections: Section[] }
  | { status: 'failed' };
const indexes = shallowRef<Partial<Record<DocsLocale, IndexState>>>({});
const index = computed<IndexState>(() => indexes.value[locale.value] ?? { status: 'idle' });

async function loadIndex(): Promise<void> {
  const forLocale = locale.value;
  const state = indexes.value[forLocale]?.status;
  if (state === 'loading' || state === 'ready') return;
  indexes.value = { ...indexes.value, [forLocale]: { status: 'loading' } };
  try {
    const sections = await queryCollectionSearchSections(collection.value, {
      ignoredTags: ['pre', 'code-tabs'],
    });
    const readable = sections.map((section) => ({
      ...section,
      content: withGatewayUrl(section.content),
    }));
    indexes.value = { ...indexes.value, [forLocale]: { status: 'ready', sections: readable } };
  } catch {
    indexes.value = { ...indexes.value, [forLocale]: { status: 'failed' } };
  }
}

const pageNumbers = computed(() => new Map(pages.value.map((page) => [page.path, page.number])));
const rows = computed<SearchRow[]>(() =>
  index.value.status === 'ready'
    ? searchSections(index.value.sections, query.value, (path) => pageNumbers.value.get(path))
    : [],
);
const hasQuery = computed(() => query.value.trim() !== '');
watch(rows, (newRows) => (highlightedIndex.value = firstMatchIndexOf(newRows)));

const rowIdOf = (rowIndex: number): string => `ds-search-row-${rowIndex}`;
const activeDescendant = computed(() =>
  rows.value.length > 0 ? rowIdOf(highlightedIndex.value) : undefined,
);

function open(): void {
  if (!dialog.value || dialog.value.open) return;
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value.showModal();
  void nextTick(() => input.value?.select());
  void loadIndex();
}

function close(): void {
  dialog.value?.close();
}

function handleClosed(): void {
  returnFocusTo?.focus();
  returnFocusTo = null;
}

async function go(row: SearchRow): Promise<void> {
  close();
  const [path, hash] = row.to.split('#');
  if (hash && path === docsPagePathOf(route.path)) {
    pickHeading(hash);
    return;
  }
  await navigateTo(row.to);
}

function moveHighlight(step: number): void {
  const count = rows.value.length;
  if (count === 0) return;
  highlightedIndex.value = (highlightedIndex.value + step + count) % count;
  void nextTick(() =>
    document.getElementById(rowIdOf(highlightedIndex.value))?.scrollIntoView({ block: 'nearest' }),
  );
}

function handleInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    const row = rows.value[highlightedIndex.value];
    if (row) void go(row);
  }
}

function isTypingIn(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  const isModifierK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
  const isSlash =
    event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingIn(event.target);
  if (!isModifierK && !isSlash) return;
  event.preventDefault();
  open();
});

function handleDialogClick(event: MouseEvent): void {
  if (event.target === dialog.value) close();
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="dialog"
    class="ds-search"
    :aria-label="t('searchDocs')"
    @close="handleClosed"
    @click="handleDialogClick"
  >
    <div class="ds-search__panel">
      <div class="ds-search__field">
        <Search :size="18" :stroke-width="1.75" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          class="ds-search__input"
          type="search"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('searchPlaceholder')"
          :aria-label="t('searchDocs')"
          aria-autocomplete="list"
          aria-controls="ds-search-results"
          :aria-expanded="rows.length > 0"
          :aria-activedescendant="activeDescendant"
          @keydown="handleInputKeydown"
        />
        <button class="icon-button" type="button" :aria-label="t('closeSearch')" @click="close">
          <X :size="16" :stroke-width="1.75" aria-hidden="true" />
        </button>
      </div>
      <ul
        v-show="rows.length > 0"
        id="ds-search-results"
        class="ds-search__results"
        role="listbox"
        :aria-label="t('searchResults')"
      >
        <li
          v-for="(row, rowIndex) in rows"
          :id="rowIdOf(rowIndex)"
          :key="row.to"
          class="ds-search__row"
          :class="{
            'ds-search__row--page': row.kind === 'page',
            'ds-search__row--highlighted': rowIndex === highlightedIndex,
          }"
          role="option"
          :aria-selected="rowIndex === highlightedIndex"
          @click="go(row)"
          @mousemove="highlightedIndex = rowIndex"
        >
          <span class="ds-search__title">
            <span v-if="row.pageNumber" class="ds-search__number">{{
              formatPageNumber(row.pageNumber)
            }}</span>
            {{ row.title }}
          </span>
          <span v-if="row.snippet" class="ds-search__snippet"
            >{{ row.snippet.before }}<mark>{{ row.snippet.match }}</mark
            >{{ row.snippet.after }}</span
          >
        </li>
      </ul>
      <p v-if="index.status === 'failed'" class="ds-search__status ds-search__status--failed">
        {{ t('searchFailed') }}
      </p>
      <p v-else-if="index.status === 'loading'" class="ds-search__status">
        {{ t('searchLoading') }}
      </p>
      <p v-else-if="!hasQuery" class="ds-search__status">{{ t('searchHint') }}</p>
      <p v-else-if="rows.length === 0" class="ds-search__status" role="status">
        {{ t('searchNoResults', { query: query.trim() }) }}
      </p>
    </div>
  </dialog>
</template>
