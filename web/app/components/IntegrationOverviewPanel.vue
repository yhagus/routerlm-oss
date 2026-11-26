<script setup lang="ts">
import { CloudOff, RefreshCw } from '@lucide/vue';
import { isOverviewRange, OVERVIEW_RANGES, type OverviewRange } from '~/lib/overview';
import { timeRangeStart, type UsageSummary } from '~/lib/usage';

const props = defineProps<{ integrationId: string }>();

const range = useQueryParam<OverviewRange>('range', { default: '7d', isValid: isOverviewRange });
const rangeOptions = Object.entries(OVERVIEW_RANGES).map(([value, label]) => ({ value, label }));

function pickRange(value: string): void {
  if (isOverviewRange(value)) range.value = value;
}

const from = ref(timeRangeStart(range.value, Date.now()));
watch(range, () => {
  from.value = timeRangeStart(range.value, Date.now());
});

const {
  data: summary,
  status,
  error: loadError,
  refresh: refreshSummary,
} = useDashboardApi<UsageSummary>('/usage/totals', {
  query: computed(() => ({ integrationId: props.integrationId, from: from.value })),
});

async function refresh(): Promise<void> {
  from.value = timeRangeStart(range.value, Date.now());
  await nextTick();
  await refreshSummary({ dedupe: 'defer' });
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
    <button
      class="icon-action"
      type="button"
      aria-label="Refresh totals"
      title="Refresh"
      @click="refresh()"
    >
      <RefreshCw :size="15" />
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
