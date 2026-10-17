<script setup lang="ts">
// Port of v1 cli-tools/components/ToolSummaryCard.js
import { RouterLink } from "vue-router";
import Card from "@/components/ui/card.vue";
import type { CliTool } from "@/lib/cliTools";

const props = defineProps<{
  toolId: string;
  tool: CliTool;
  status?: Record<string, unknown>;
}>();

function getStatus(status: Record<string, unknown> | undefined) {
  if (!status)
    return { label: "Unknown", cls: "bg-muted text-muted-foreground" };
  if (!status.installed)
    return { label: "Not installed", cls: "bg-muted text-muted-foreground" };
  if (status.hasLobakAI)
    return {
      label: "Connected",
      cls: "bg-success/12 text-success",
    };
  return {
    label: "Not configured",
    cls: "bg-warning/12 text-warning",
  };
}
</script>

<template>
  <RouterLink :to="`/dashboard/cli-tools/${toolId}`" class="block">
    <Card
      class="h-full cursor-pointer overflow-hidden p-[15px] transition-colors hover:border-primary/50"
    >
      <div class="flex h-full flex-col gap-2">
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
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-sm font-medium">{{ tool.name }}</h3>
            <span
              class="mt-1 inline-block rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium"
              :class="getStatus(status).cls"
              >{{ getStatus(status).label }}</span
            >
          </div>
          <span
            class="material-symbols-outlined shrink-0 text-[18px] text-muted-foreground"
            >chevron_right</span
          >
        </div>
      </div>
    </Card>
  </RouterLink>
</template>
