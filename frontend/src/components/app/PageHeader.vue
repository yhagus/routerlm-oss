<script setup lang="ts">
defineProps<{ title: string; description: string }>();
</script>

<template>
  <div
    class="flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between"
  >
    <div>
      <h2 class="text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
        {{ title }}
      </h2>
      <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
