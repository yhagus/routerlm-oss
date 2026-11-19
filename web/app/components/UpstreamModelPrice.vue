<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PriceSummary } from "~/lib/upstreamModelPrice";

/**
 * One Price cell for any Kind: the amount over its unit. Hovering lists every
 * published price, such as cache prices or each video resolution.
 */
defineProps<{ summary: PriceSummary | null }>();
</script>

<template>
  <template v-if="summary">
    <TooltipProvider v-if="summary.lines.length" :delay-duration="100">
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="price-cell price-cell--detailed">
            <strong>{{ summary.value }}</strong>
            <span class="price-cell__unit">{{ summary.unit }}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent class="price-tooltip" side="left">
          <span v-for="line in summary.lines" :key="line.label" class="price-tooltip__line">
            <span>{{ line.label }}</span>
            <strong class="tabular">{{ line.value }}</strong>
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <span v-else class="price-cell">
      <strong>{{ summary.value }}</strong>
      <span class="price-cell__unit">{{ summary.unit }}</span>
    </span>
  </template>
  <template v-else>—</template>
</template>
