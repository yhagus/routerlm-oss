<script setup lang="ts">
defineProps<{
  code?: string;
  language?: string | null;
  filename?: string | null;
  highlights?: number[];
  meta?: string | null;
  class?: string | null;
}>();
</script>

<template>
  <DocsCodeBlock :examples="[{ language: language ?? '', code: code ?? '' }]" />
</template>
