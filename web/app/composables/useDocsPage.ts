import { computed } from "vue";

/**
 * The docs page the address names, in the language the address names
 * (/docs/... or /id/docs/...). The page body and the contents column share
 * one query.
 */
export function useDocsPage() {
  const route = useRoute();
  const { collection } = useDocsLocale();
  const pagePath = computed(() => docsPagePathOf(route.path));

  const { data: page, status } = useAsyncData(
    () => `docs-page-${pagePath.value}`,
    () => queryCollection(collection.value).path(pagePath.value).first(),
    { lazy: true },
  );

  return { pagePath, page, status };
}
