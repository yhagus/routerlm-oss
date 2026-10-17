<script setup lang="ts">
// Shown by defineAsyncComponent while a route chunk (and its first data) load.
// Navigation switches immediately; this skeleton fills the content area so a
// slow connection never looks like a dead click.
import Skeleton from "@/components/ui/skeleton.vue";
</script>

<template>
  <div class="space-y-6" aria-busy="true" aria-live="polite">
    <span class="sr-only">Loading…</span>
    <Skeleton class="h-8 w-48" />
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Skeleton v-for="i in 4" :key="i" class="h-28" />
    </div>
    <Skeleton class="h-64 w-full" />
  </div>
</template>
