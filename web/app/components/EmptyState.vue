<script setup lang="ts">
import type { Component } from "vue";

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
