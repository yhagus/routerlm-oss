<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue';
import { computed, type Component } from 'vue';
import type { ThemePreference } from '~/composables/useTheme';
import type { DocsMessageKey } from '~/lib/docsMessages';

const { preference, nextPreference, cycle } = useTheme();
const { t } = useDocsLocale();

const ICONS: Record<ThemePreference, Component> = { system: Monitor, light: Sun, dark: Moon };
const NAMES: Record<ThemePreference, DocsMessageKey> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};

const label = computed(() =>
  t('themeSwitch', {
    current: t(NAMES[preference.value]),
    next: t(NAMES[nextPreference.value]),
  }),
);
</script>

<template>
  <button class="icon-button" type="button" :aria-label="label" :title="label" @click="cycle">
    <component :is="ICONS[preference]" :size="15" :stroke-width="1.8" aria-hidden="true" />
  </button>
</template>
