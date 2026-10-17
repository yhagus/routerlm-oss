<script setup lang="ts" generic="T extends string">
import { computed } from "vue";
import { cn } from "@/lib/utils";

const props = defineProps<{
  options: ReadonlyArray<{ value: T; label: string }>;
  class?: string;
}>();
const model = defineModel<T>({ required: true });
const index = computed(() =>
  Math.max(
    0,
    props.options.findIndex((option) => option.value === model.value),
  ),
);
</script>

<template>
  <div
    role="tablist"
    :class="
      cn(
        'relative inline-grid h-9 auto-cols-fr grid-flow-col items-center rounded-md bg-muted p-1',
        $props.class,
      )
    "
  >
    <span
      class="pointer-events-none absolute inset-y-1 left-1 rounded-[5px] bg-background shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
      :style="{
        width: `calc((100% - 0.5rem) / ${options.length})`,
        transform: `translateX(${index * 100}%)`,
      }"
      aria-hidden="true"
    />
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      class="relative z-10 h-7 min-w-20 rounded-[5px] px-3 text-xs font-medium transition-colors duration-200"
      :class="
        model === option.value
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      "
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
