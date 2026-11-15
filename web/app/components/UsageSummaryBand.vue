<script setup lang="ts">
import { computed } from "vue";
import { compactNumber, percent } from "~/lib/chart";
import { formatCost, formatCount, formatDuration, type UsageSummary } from "~/lib/usage";

/**
 * One row of statistics over the filtered Usage Logs. Without a summary (loading or failed) it
 * keeps its shape and shows "—", so the log table below doesn't jump.
 */
const props = defineProps<{
  summary: UsageSummary | null | undefined;
  /** True while the summary request is in flight; a failed request leaves it false. */
  isLoading: boolean;
}>();

const NO_DATA = "—";

/** Percentiles are interpolated, so they can land between whole milliseconds. */
function formatLatency(ms: number | null): string {
  return formatDuration(ms === null ? null : Math.round(ms));
}

/** The notes only make sense once there is at least one request to describe. */
const described = computed(() =>
  props.summary && props.summary.requestCount > 0 ? props.summary : null,
);

const totalTokens = computed(() =>
  props.summary ? props.summary.inputTokens + props.summary.outputTokens : null,
);

const hasMedianDuration = computed(() => (props.summary?.durationMsP50 ?? null) !== null);

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
          p95 {{ formatLatency(described.durationMsP95) }} · first token
          {{ formatLatency(described.timeToFirstTokenMsP50) }}
        </template>
      </p>
    </div>
  </div>
</template>
