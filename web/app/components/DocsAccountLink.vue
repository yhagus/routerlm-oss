<script setup lang="ts">
import { ArrowRight } from '@lucide/vue';

const currentUser = useCurrentUser();
const { t } = useDocsLocale();
</script>

<template>
  <NuxtLink v-if="currentUser" to="/" class="ds-cell-link">
    {{ t('dashboard') }}<ArrowRight :size="14" :stroke-width="2" aria-hidden="true" />
  </NuxtLink>
  <NuxtLink v-else to="/login" class="ds-cell-link">
    {{ t('signIn') }}<ArrowRight :size="14" :stroke-width="2" aria-hidden="true" />
  </NuxtLink>
</template>
