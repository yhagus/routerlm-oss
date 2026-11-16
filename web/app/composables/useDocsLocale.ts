import { computed, type ComputedRef } from "vue";
import { DOCS_MESSAGES, type DocsLocale, type DocsMessageKey } from "~/lib/docsMessages";

/** Indonesian pages sit under this prefix; English keeps the unprefixed /docs. */
const INDONESIAN_PREFIX = "/id";

/** The @nuxt/content collection holding each language's pages (see content.config.ts). */
const COLLECTIONS = { en: "docs", id: "docs_id" } as const satisfies Record<DocsLocale, string>;

export function docsLocaleOf(path: string): DocsLocale {
  const isIndonesian =
    path === `${INDONESIAN_PREFIX}/docs` || path.startsWith(`${INDONESIAN_PREFIX}/docs/`);
  return isIndonesian ? "id" : "en";
}

/** The same docs page in another language: /docs/errors ⇄ /id/docs/errors. */
export function docsPathIn(locale: DocsLocale, path: string): string {
  const englishPath = docsLocaleOf(path) === "id" ? path.slice(INDONESIAN_PREFIX.length) : path;
  return locale === "id" ? `${INDONESIAN_PREFIX}${englishPath}` : englishPath;
}

/** A docs page's address without a trailing slash: "/docs/" and "/docs" are the same page. */
export function docsPagePathOf(routePath: string): string {
  return routePath.replace(/\/+$/, "");
}

/** The current docs language, read from the route, and what depends on it. */
export function useDocsLocale(): {
  locale: ComputedRef<DocsLocale>;
  collection: ComputedRef<(typeof COLLECTIONS)[DocsLocale]>;
  /** The overview page: /docs or /id/docs. */
  docsRoot: ComputedRef<string>;
  /** The docs interface text for `key`, with each `{name}` replaced from `values`. */
  t: (key: DocsMessageKey, values?: Record<string, string>) => string;
} {
  const route = useRoute();
  const locale = computed(() => docsLocaleOf(route.path));
  const collection = computed(() => COLLECTIONS[locale.value]);
  const docsRoot = computed(() => docsPathIn(locale.value, "/docs"));

  function t(key: DocsMessageKey, values: Record<string, string> = {}): string {
    return DOCS_MESSAGES[locale.value][key].replace(
      /\{(\w+)\}/g,
      (placeholder, name: string) => values[name] ?? placeholder,
    );
  }

  return { locale, collection, docsRoot, t };
}
