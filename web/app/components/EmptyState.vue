<script setup lang="ts">
import type { Component } from "vue";

/**
 * A centred message for a list or section with nothing to show: an icon on
 * top, then a `<strong>` headline and an optional `<span>` hint or action in
 * the slot. `tone="error"` tints the icon for a failed load.
 */
withDefaults(defineProps<{ icon: Component; tone?: "neutral" | "error" }>(), {
  tone: "neutral",
});
</script>

<template>
  <div class="empty-state" :class="{ 'empty-state--error': tone === 'error' }">
    <span class="empty-state__icon" aria-hidden="true">
      <component :is="icon" :size="18" :stroke-width="1.75" />
    </span>
    <slot />
  </div>
</template>
