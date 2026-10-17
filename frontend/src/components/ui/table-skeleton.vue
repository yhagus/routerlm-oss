<script setup lang="ts">
import Skeleton from "@/components/ui/skeleton.vue";

withDefaults(
  defineProps<{
    // One entry per column. `lines` is the number of stacked bars in a cell.
    columns: ReadonlyArray<{
      width: string;
      align?: "start" | "end";
      lines?: 1 | 2;
    }>;
    rows?: number;
    label?: string;
  }>(),
  { rows: 5, label: "Loading" },
);
</script>

<template>
  <div
    class="overflow-hidden rounded-lg border"
    role="status"
    :aria-label="label"
  >
    <div class="h-8 border-b bg-muted/60" />
    <div
      v-for="row in rows"
      :key="row"
      class="flex items-center gap-5 border-b border-border/60 px-3.75 py-2.5 last:border-b-0"
    >
      <div
        v-for="(column, columnIndex) in columns"
        :key="columnIndex"
        class="flex flex-col gap-1.5"
        :class="column.align === 'end' ? 'items-end' : 'items-start'"
        :style="{ width: column.width }"
      >
        <Skeleton class="h-3.5 w-3/4" />
        <Skeleton v-if="column.lines === 2" class="h-2.5 w-full" />
      </div>
    </div>
  </div>
</template>
