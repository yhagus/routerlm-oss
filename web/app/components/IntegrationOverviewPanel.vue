<script setup lang="ts">
import { CloudOff, RefreshCw } from "@lucide/vue";
import { isOverviewRange, OVERVIEW_RANGES, type OverviewRange } from "~/lib/overview";
import { timeRangeStart, type UsageSummary } from "~/lib/usage";

/** The Integration's request totals over a recent period, from its Customers' Usage Logs. */
const props = defineProps<{ integrationId: string }>();

const range = useQueryParam<OverviewRange>("range", { default: "7d", isValid: isOverviewRange });
const rangeOptions = Object.entries(OVERVIEW_RANGES).map(([value, label]) => ({ value, label }));

function pickRange(value: string): void {
  if (isOverviewRange(value)) range.value = value;
}

// Fixed when the range is picked (or refreshed), like the Usage page's window.
const from = ref(timeRangeStart(range.value, Date.now()));
watch(range, () => {
  from.value = timeRangeStart(range.value, Date.now());
});

const {
  data: summary,
  status,
  error: loadError,
  refresh: refreshSummary,
} = useDashboardApi<UsageSummary>("/usage/totals", {
  query: computed(() => ({ integrationId: props.integrationId, from: from.value })),
});

/** Moves the window to end now; the moved window reloads the totals, which `defer` joins. */
async function refresh(): Promise<void> {
  from.value = timeRangeStart(range.value, Date.now());
  await nextTick();
  await refreshSummary({ dedupe: "defer" });
}
</script>

<template>
  <div class="integration-overview__tools">
    <AppSelect
      :model-value="range"
      :options="rangeOptions"
      label="Time range"
      @update:model-value="pickRange"
    />
    <button class="button button--quiet" type="button" @click="refresh()">
      <RefreshCw :size="14" /> Refresh
    </button>
  </div>
  <section v-if="loadError" class="panel">
    <EmptyState :icon="CloudOff" tone="error">
      <strong>Couldn't load the totals.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>
  </section>
  <UsageSummaryBand v-else :summary="summary" :is-loading="status === 'pending'" />
</template>
