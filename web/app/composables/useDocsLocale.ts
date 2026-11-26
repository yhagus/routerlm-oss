import { computed, type ComputedRef } from 'vue';
import { DOCS_MESSAGES, type DocsLocale, type DocsMessageKey } from '~/lib/docsMessages';

const INDONESIAN_PREFIX = '/id';

const COLLECTIONS = { en: 'docs', id: 'docs_id' } as const satisfies Record<DocsLocale, string>;

export function docsLocaleOf(path: string): DocsLocale {
  const isIndonesian =
    path === `${INDONESIAN_PREFIX}/docs` || path.startsWith(`${INDONESIAN_PREFIX}/docs/`);
  return isIndonesian ? 'id' : 'en';
}

export function docsPathIn(locale: DocsLocale, path: string): string {
  const englishPath = docsLocaleOf(path) === 'id' ? path.slice(INDONESIAN_PREFIX.length) : path;
  return locale === 'id' ? `${INDONESIAN_PREFIX}${englishPath}` : englishPath;
}

export function docsPagePathOf(routePath: string): string {
  return routePath.replace(/\/+$/, '');
}

export function useDocsLocale(): {
  locale: ComputedRef<DocsLocale>;
  collection: ComputedRef<(typeof COLLECTIONS)[DocsLocale]>;
  docsRoot: ComputedRef<string>;
  t: (key: DocsMessageKey, values?: Record<string, string>) => string;
} {
  const route = useRoute();
  const locale = computed(() => docsLocaleOf(route.path));
  const collection = computed(() => COLLECTIONS[locale.value]);
  const docsRoot = computed(() => docsPathIn(locale.value, '/docs'));

  function t(key: DocsMessageKey, values: Record<string, string> = {}): string {
    return DOCS_MESSAGES[locale.value][key].replace(
      /\{(\w+)\}/g,
      (placeholder, name: string) => values[name] ?? placeholder,
    );
  }

  return { locale, collection, docsRoot, t };
}
