<script setup lang="ts">
// Port of v1 cli-tools/CLIToolsPageClient.js
import { useQuery } from "@tanstack/vue-query";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import ToolSummaryCard from "@/components/tools/ToolSummaryCard.vue";
import MitmLinkCard from "@/components/tools/MitmLinkCard.vue";
import { api } from "@/lib/api";
import { CLI_TOOLS, MITM_TOOLS } from "@/lib/cliTools";

const statuses = useQuery({
  queryKey: ["cli-tools", "statuses"],
  queryFn: api.cliTools.allStatuses,
});
</script>

<template>
  <div
    class="theme-v2 mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0"
  >
    <div
      v-if="statuses.isPending.value"
      class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
    >
      <Card v-for="index in 6" :key="index" class="flex items-center gap-3 p-3">
        <Skeleton class="size-8 rounded-lg" />
        <div class="flex-1 space-y-2">
          <Skeleton class="h-3.5 w-24" />
          <Skeleton class="h-3 w-16 rounded-full" />
        </div>
      </Card>
    </div>

    <template v-else>
      <div
        class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
      >
        <ToolSummaryCard
          v-for="[toolId, tool] in Object.entries(CLI_TOOLS)"
          :key="toolId"
          :tool-id="toolId"
          :tool="tool"
          :status="statuses.data.value?.[toolId]"
        />
      </div>
      <div class="flex flex-col gap-3 sm:gap-4">
        <div class="flex items-center gap-2 px-1">
          <span class="material-symbols-outlined text-[18px] text-primary"
            >security</span
          >
          <h2 class="text-sm font-semibold">MITM Tools</h2>
        </div>
        <div
          class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
        >
          <MitmLinkCard
            v-for="[toolId, tool] in Object.entries(MITM_TOOLS)"
            :key="toolId"
            :tool="tool"
          />
        </div>
      </div>
    </template>
  </div>
</template>
