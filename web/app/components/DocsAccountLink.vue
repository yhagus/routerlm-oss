<script setup lang="ts">
import { ArrowRight } from "@lucide/vue";

/**
 * The way back to the dashboard for an operator already signed in this visit,
 * and to the sign-in page for anyone else. The docs never ask the backend who
 * is signed in, so a fresh visit always offers "Sign in".
 */
const currentUser = useCurrentUser();
const { t } = useDocsLocale();
</script>

<template>
  <NuxtLink v-if="currentUser" to="/" class="ds-cell-link">
    {{ t("dashboard") }}<ArrowRight :size="14" :stroke-width="2" aria-hidden="true" />
  </NuxtLink>
  <NuxtLink v-else to="/login" class="ds-cell-link">
    {{ t("signIn") }}<ArrowRight :size="14" :stroke-width="2" aria-hidden="true" />
  </NuxtLink>
</template>
