<script setup lang="ts">
// Port of v1 cli-tools/components/MitmLinkCard.js
import { RouterLink } from "vue-router";
import Card from "@/components/ui/card.vue";
import type { CliTool } from "@/lib/cliTools";

defineProps<{ tool: CliTool }>();
</script>

<template>
  <RouterLink to="/dashboard/mitm" class="block">
    <Card
      class="cursor-pointer overflow-hidden p-[15px] transition-colors hover:border-primary/50"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="flex size-8 shrink-0 items-center justify-center">
            <img
              v-if="tool.image"
              :src="tool.image"
              :alt="tool.name"
              class="size-8 rounded-lg object-contain"
              loading="lazy"
              decoding="async"
              @error="
                ($event.target as HTMLImageElement).style.display = 'none'
              "
            />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-medium">{{ tool.name }}</h3>
              <span
                class="rounded-[5px] bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >MITM</span
              >
            </div>
            <p class="truncate text-xs text-muted-foreground">
              {{ tool.description }}
            </p>
          </div>
        </div>
        <span
          class="material-symbols-outlined text-[20px] text-muted-foreground"
          >chevron_right</span
        >
      </div>
    </Card>
  </RouterLink>
</template>
