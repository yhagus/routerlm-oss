<script setup lang="ts">
import { Info } from '@lucide/vue';
import { computed } from 'vue';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { compactNumber, percent } from '~/lib/chart';
import { ERROR_ORIGIN_LABELS, ERROR_ORIGINS } from '~/lib/errorOrigins';
import {
  formatCost,
  formatCount,
  formatDuration,
  formatOutputSpeed,
  OUTPUT_SPEED_HINT,
  type UsageSummary,
} from '~/lib/usage';

const props = defineProps<{
  summary: UsageSummary | null | undefined;
  isLoading: boolean;
}>();

const NO_DATA = '—';

function formatLatency(ms: number | null): string {
  return formatDuration(ms === null ? null : Math.round(ms));
}

const described = computed(() =>
  props.summary && props.summary.requestCount > 0 ? props.summary : null,
);

const totalTokens = computed(() =>
  props.summary ? props.summary.inputTokens + props.summary.outputTokens : null,
);

const failedByOriginNote = computed(() => {
  const failedByOrigin = described.value?.failedByOrigin;
  if (!failedByOrigin) return null;
  const parts = ERROR_ORIGINS.filter((origin) => failedByOrigin[origin] > 0).map(
    (origin) =>
      `${formatCount(failedByOrigin[origin])} ${ERROR_ORIGIN_LABELS[origin].toLowerCase()}`,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
});

const hasMedianDuration = computed(() => (props.summary?.durationMsP50 ?? null) !== null);
const hasMedianOutputSpeed = computed(() => (props.summary?.outputSpeedP50 ?? null) !== null);

function formatTokens(count: number | null | undefined): string {
  return count === null || count === undefined ? NO_DATA : compactNumber(count);
}
</script>

<template>
  <div
    class="usage-summary"
    role="group"
    aria-label="Summary of the filtered requests"
    :aria-busy="isLoading || undefined"
  >
    <div class="usage-summary__stat">
      <span class="usage-summary__label">Requests</span>
      <strong class="tabular">{{ summary ? formatCount(summary.requestCount) : NO_DATA }}</strong>
      <p class="usage-summary__note tabular">
        <template v-if="described">
          {{ percent(described.succeededCount / described.requestCount) }} succeeded
          <template v-if="described.failedCount > 0">
            · <span class="usage-summary__failed">{{ formatCount(described.failedCount) }}</span>
            failed
          </template>
          <template v-if="described.cancelledCount > 0">
            ·
            <span class="usage-summary__cancelled">{{
              formatCount(described.cancelledCount)
            }}</span>
            cancelled
          </template>
        </template>
      </p>
      <p v-if="failedByOriginNote" class="usage-summary__note tabular">
        Failed by origin: {{ failedByOriginNote }}
      </p>
    </div>

    <div class="usage-summary__stat">
      <span class="usage-summary__label">Cost</span>
      <strong class="tabular">{{ summary ? formatCost(summary.cost) : NO_DATA }}</strong>
      <p class="usage-summary__note tabular">
        <template v-if="described">
          {{ formatCost(described.cost / described.requestCount) }} per request
        </template>
      </p>
    </div>

    <div class="usage-summary__stat">
      <span class="usage-summary__label">Tokens</span>
      <strong class="tabular">{{ formatTokens(totalTokens) }}</strong>
      <p class="usage-summary__note tabular">
        <template v-if="described">
          {{ compactNumber(described.inputTokens) }} in ·
          {{ compactNumber(described.outputTokens) }} out
        </template>
      </p>
    </div>

    <div class="usage-summary__stat">
      <span class="usage-summary__label">Cache read</span>
      <strong class="tabular">{{ formatTokens(summary?.cacheReadTokens) }}</strong>
      <p class="usage-summary__note tabular">
        <template v-if="described">
          <template v-if="described.inputTokens > 0">
            {{ percent(described.cacheReadTokens / described.inputTokens, 0) }} of input ·
          </template>
          {{ compactNumber(described.cacheWriteTokens) }} written
        </template>
      </p>
    </div>

    <div class="usage-summary__stat">
      <span class="usage-summary__label">Latency</span>
      <strong class="tabular">
        {{ formatLatency(summary?.durationMsP50 ?? null) }}
        <small v-if="hasMedianDuration">median</small>
      </strong>
      <p class="usage-summary__note tabular">
        <template v-if="described">
          p95 {{ formatLatency(described.durationMsP95) }} · Time to First Token
          {{ formatLatency(described.timeToFirstTokenMsP50) }}
        </template>
      </p>
    </div>

    <div class="usage-summary__stat">
      <TooltipProvider :delay-duration="100">
        <Tooltip>
          <TooltipTrigger as-child>
            <button type="button" class="usage-summary__label usage-summary__hint">
              Output Speed <Info :size="11" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent class="usage-summary__tooltip">{{ OUTPUT_SPEED_HINT }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <strong class="tabular">
        {{ formatOutputSpeed(summary?.outputSpeedP50 ?? null) }}
        <small v-if="hasMedianOutputSpeed">median</small>
      </strong>
      <p class="usage-summary__note tabular">
        <template v-if="summary && summary.outputSpeedP5 !== null">
          p5 {{ formatOutputSpeed(summary.outputSpeedP5) }}
        </template>
        <template v-else-if="summary">No streamed request to measure</template>
      </p>
    </div>
  </div>
</template>
