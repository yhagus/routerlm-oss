import { computed, type ComputedRef } from 'vue';

export interface DocsContentsEntry {
  path: string;
  title: string;
  number: number;
}

export function formatPageNumber(pageNumber: number): string {
  return String(pageNumber).padStart(2, '0');
}

function pageNumberOf(stem: string): number {
  const fileName = stem.split('/').at(-1) ?? '';
  return Number.parseInt(fileName, 10);
}

function byReadingOrder(first: { stem: string }, second: { stem: string }): number {
  return pageNumberOf(first.stem) - pageNumberOf(second.stem);
}

export function useDocsContents(): {
  pages: ComputedRef<DocsContentsEntry[]>;
  isLoading: ComputedRef<boolean>;
  currentPage: ComputedRef<DocsContentsEntry | null>;
  pageCount: ComputedRef<number>;
  pageCounter: ComputedRef<string | null>;
} {
  const route = useRoute();
  const { locale, collection } = useDocsLocale();

  const { data, status } = useAsyncData(
    () => `docs-contents-${locale.value}`,
    () => queryCollection(collection.value).select('title', 'path', 'stem').all(),
    { lazy: true },
  );

  const pages = computed(() =>
    (data.value ?? []).toSorted(byReadingOrder).map((page, index) => ({
      path: page.path,
      title: page.title,
      number: index + 1,
    })),
  );
  const currentPage = computed(
    () => pages.value.find((page) => page.path === docsPagePathOf(route.path)) ?? null,
  );

  const pageCount = computed(() => pages.value.length);
  const pageCounter = computed(() =>
    currentPage.value
      ? `${formatPageNumber(currentPage.value.number)} / ${formatPageNumber(pageCount.value)}`
      : null,
  );

  return {
    pages,
    isLoading: computed(() => status.value === 'pending' && !data.value),
    currentPage,
    pageCount,
    pageCounter,
  };
}
