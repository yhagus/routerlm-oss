<script setup lang="ts">
/**
 * Every fenced code block in the docs. It renders from the block's source
 * rather than the parsed slot, so the real gateway URL can replace the placeholder.
 */
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
