<script setup lang="ts">
/**
 * The loading indicator: a small ring with a short label. With `label` empty
 * it is a bare ring for tight spots (a count, a button), still announced to
 * screen readers.
 */
withDefaults(defineProps<{ label?: string }>(), { label: "Loading…" });
</script>

<template>
  <span class="loading-state" role="status">
    <span class="spinner" aria-hidden="true" />
    <span v-if="label">{{ label }}</span>
    <span v-else class="sr-only">Loading…</span>
  </span>
</template>
