<script setup lang="ts">
import { Ban } from "lucide-vue-next";
import Card from "@/components/ui/card.vue";
import Badge from "@/components/ui/badge.vue";

withDefaults(
  defineProps<{ title: string; description: string; compact?: boolean }>(),
  { compact: false },
);
</script>

<template>
  <Card
    :class="
      compact
        ? 'border-warning/30 bg-warning/5 p-4'
        : 'border-warning/30 bg-warning/5 p-5'
    "
  >
    <div class="flex items-start gap-3">
      <div
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/12 text-warning"
      >
        <Ban class="size-4" />
      </div>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-sm font-semibold">{{ title }}</h2>
          <Badge variant="warning">Unavailable in v2</Badge>
        </div>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">
          {{ description }}
        </p>
        <slot />
      </div>
    </div>
  </Card>
</template>
