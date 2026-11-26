<script setup lang="ts">
import { computed } from 'vue';
import type { DocsLocale } from '~/lib/docsMessages';

const route = useRoute();
const { locale, t } = useDocsLocale();

const LANGUAGES: { locale: DocsLocale; code: string; name: string }[] = [
  { locale: 'en', code: 'EN', name: 'English' },
  { locale: 'id', code: 'ID', name: 'Bahasa Indonesia' },
];

const options = computed(() =>
  LANGUAGES.map((language) => ({
    ...language,
    to: docsPathIn(language.locale, route.path),
    isCurrent: language.locale === locale.value,
  })),
);
</script>

<template>
  <nav class="segmented ds-language" :aria-label="t('language')">
    <NuxtLink
      v-for="option in options"
      :key="option.locale"
      :to="option.to"
      class="segmented__option ds-language__option"
      :hreflang="option.locale"
      :lang="option.locale"
      :aria-current="option.isCurrent ? 'page' : undefined"
    >
      {{ option.code }}<span class="sr-only"> {{ option.name }}</span>
    </NuxtLink>
  </nav>
</template>
