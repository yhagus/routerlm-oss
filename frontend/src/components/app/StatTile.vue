<script setup lang="ts">
import { cn } from "@/lib/utils";
defineProps<{
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "success" | "warning" | "destructive";
}>();
</script>

<template>
  <div class="rounded-xl border bg-card px-5 py-4 shadow-sm">
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs font-medium text-muted-foreground">{{ label }}</p>
      <span
        :class="
          cn(
            'size-2 rounded-full bg-primary',
            tone === 'success' && 'bg-success',
            tone === 'warning' && 'bg-warning',
            tone === 'destructive' && 'bg-destructive',
          )
        "
      />
    </div>
    <p class="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
      {{ value }}
    </p>
    <p class="mt-1 text-xs text-muted-foreground">{{ detail }}</p>
  </div>
</template>
