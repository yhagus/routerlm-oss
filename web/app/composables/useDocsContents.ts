import { computed, type ComputedRef } from "vue";

/** A page in the docs' contents, numbered from 1 in reading order. */
export interface DocsContentsEntry {
  path: string;
  title: string;
  number: number;
}

/** A page or section number as the datasheet prints it: 3 becomes "03". */
export function formatPageNumber(pageNumber: number): string {
  return String(pageNumber).padStart(2, "0");
}

/**
 * The page files are numbered (1.authentication.md, ..., 10.integrations.md).
 * Their stems keep that number, compared as a number: as text, 10 sorts before 2.
 */
function pageNumberOf(stem: string): number {
  const fileName = stem.split("/").at(-1) ?? "";
  return Number.parseInt(fileName, 10);
}

function byReadingOrder(first: { stem: string }, second: { stem: string }): number {
  return pageNumberOf(first.stem) - pageNumberOf(second.stem);
}

/**
 * The current language's pages in reading order, and where the reader is
 * among them. The layout, the page and the pager share one query.
 */
export function useDocsContents(): {
  pages: ComputedRef<DocsContentsEntry[]>;
  isLoading: ComputedRef<boolean>;
  /** The page the address names, or null on an address that isn't a docs page. */
  currentPage: ComputedRef<DocsContentsEntry | null>;
  pageCount: ComputedRef<number>;
  /** "03 / 09" on the third of nine pages; null off the contents or while they load. */
  pageCounter: ComputedRef<string | null>;
} {
  const route = useRoute();
  const { locale, collection } = useDocsLocale();

  const { data, status } = useAsyncData(
    () => `docs-contents-${locale.value}`,
    () => queryCollection(collection.value).select("title", "path", "stem").all(),
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
    isLoading: computed(() => status.value === "pending" && !data.value),
    currentPage,
    pageCount,
    pageCounter,
  };
}
