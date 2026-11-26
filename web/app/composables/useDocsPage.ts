import { computed } from 'vue';

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
