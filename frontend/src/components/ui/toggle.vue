<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    checked?: boolean;
    disabled?: boolean;
    size?: "sm" | "md" | "lg";
    label?: string;
    description?: string;
    title?: string;
  }>(),
  { checked: false, disabled: false, size: "md" },
);

const emit = defineEmits<{ change: [value: boolean] }>();

const sizes = {
  sm: { track: "w-8 h-4", thumb: "size-3", translate: "translate-x-4" },
  md: { track: "w-11 h-6", thumb: "size-5", translate: "translate-x-5" },
  lg: { track: "w-14 h-7", thumb: "size-6", translate: "translate-x-7" },
} as const;
</script>

<template>
  <div
    :class="
      cn('flex items-center gap-3', disabled && 'opacity-50 cursor-not-allowed')
    "
  >
    <button
      type="button"
      role="switch"
      :aria-checked="checked"
      :disabled="disabled"
      :title="title"
      :aria-label="title || label"
      :class="
        cn(
          'relative inline-flex shrink-0 cursor-pointer rounded-full',
          'transition-colors duration-200 ease-in-out',
          'focus:outline-none focus:ring-2 focus:ring-primary/30',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
          sizes[size].track,
          disabled && 'cursor-not-allowed',
        )
      "
      @click="!disabled && emit('change', !checked)"
    >
      <span
        :class="
          cn(
            'pointer-events-none mt-0.5 inline-block rounded-full bg-white shadow-sm',
            'transform transition duration-200 ease-in-out',
            checked ? sizes[size].translate : 'translate-x-0.5',
            sizes[size].thumb,
          )
        "
      />
    </button>
    <div v-if="label || description" class="flex flex-col">
      <span v-if="label" class="text-sm font-medium">{{ label }}</span>
      <span v-if="description" class="text-xs text-muted-foreground">{{
        description
      }}</span>
    </div>
  </div>
</template>
