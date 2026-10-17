<script setup lang="ts">
import { computed } from "vue";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const variants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/12 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-success/12 text-success",
        warning: "border-transparent bg-warning/12 text-warning",
        destructive: "border-transparent bg-destructive/12 text-destructive",
        info: "border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400",
        error: "border-transparent bg-destructive/12 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
type BadgeVariants = VariantProps<typeof variants>;
const props = defineProps<{
  variant?: BadgeVariants["variant"];
  class?: string;
  dot?: boolean;
}>();
const classes = computed(() =>
  cn(variants({ variant: props.variant }), props.class),
);
</script>

<template>
  <span :class="classes"
    ><span
      v-if="dot"
      class="mr-1 inline-block size-1.5 rounded-full bg-current" /><slot
  /></span>
</template>
