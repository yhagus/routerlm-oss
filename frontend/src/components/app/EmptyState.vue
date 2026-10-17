<script setup lang="ts">
import { Inbox } from "lucide-vue-next";
import { cn } from "@/lib/utils";

defineProps<{ title: string; description: string; class?: string }>();
</script>

<template>
  <div
    :class="
      cn(
        'flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center',
        $props.class,
      )
    "
  >
    <div
      class="mb-3 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"
    >
      <Inbox class="size-5" />
    </div>
    <h3 class="text-sm font-semibold">{{ title }}</h3>
    <p class="mt-1 max-w-md text-sm text-muted-foreground">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>
