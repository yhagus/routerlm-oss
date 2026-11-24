<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: "Loading…" });
</script>

<template>
  <span class="loading-state" role="status">
    <span class="spinner" aria-hidden="true" />
    <span v-if="label">{{ label }}</span>
    <span v-else class="sr-only">Loading…</span>
  </span>
</template>
