<script setup lang="ts">
import { computed } from 'vue';
import { formatPageNumber } from '~/composables/useDocsContents';

const { t } = useDocsLocale();
const { pages, currentPage } = useDocsContents();
const appVersion = useRuntimeConfig().public.appVersion;

const previousPage = computed(() =>
  currentPage.value ? pages.value[currentPage.value.number - 2] : undefined,
);
const nextPage = computed(() =>
  currentPage.value ? pages.value[currentPage.value.number] : undefined,
);
</script>

<template>
  <footer class="ds-pager">
    <nav
      v-if="previousPage || nextPage"
      class="ds-pager__links"
      :aria-label="t('previousAndNextPage')"
    >
      <NuxtLink v-if="previousPage" :to="previousPage.path" class="ds-pager__link">
        <span class="ds-pager__direction">{{ t('previous') }}</span>
        <span class="ds-pager__title">
          <span class="ds-pager__number">{{ formatPageNumber(previousPage.number) }}</span>
          {{ previousPage.title }}
        </span>
      </NuxtLink>
      <span v-else class="ds-pager__link ds-pager__link--empty" />
      <NuxtLink v-if="nextPage" :to="nextPage.path" class="ds-pager__link ds-pager__link--next">
        <span class="ds-pager__direction">{{ t('continuedOn') }}</span>
        <span class="ds-pager__title">
          <span class="ds-pager__number">{{ formatPageNumber(nextPage.number) }}</span>
          {{ nextPage.title }}
        </span>
      </NuxtLink>
      <span v-else class="ds-pager__link ds-pager__link--empty" />
    </nav>
    <p class="ds-pager__imprint">
      RouterLM · {{ t('clientApi') }} · {{ t('revision') }} {{ appVersion }}
    </p>
  </footer>
</template>
