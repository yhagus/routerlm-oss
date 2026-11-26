<script setup lang="ts">
import { Blocks, CloudOff, RefreshCw } from '@lucide/vue';
import { dateTimeFormat } from '~/lib/dateFormats';
import type { IntegrationRotation, IntegrationSummary } from '~/lib/integrations';

const props = defineProps<{ integration: IntegrationSummary }>();

const {
  data: rotations,
  error: loadError,
  status,
} = useDashboardApi<IntegrationRotation[]>(
  () => `/integrations/${props.integration.id}/rotations`,
  { watch: [() => props.integration.lastRotatedAt] },
);

const isLoading = computed(() => status.value === 'pending' && !rotations.value);

function formatTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}
</script>

<template>
  <section class="panel">
    <EmptyState v-if="loadError" :icon="CloudOff" tone="error">
      <strong>Couldn't load the rotation history.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>
    <div v-else-if="isLoading" class="loading-panel" aria-busy="true"><AppSpinner /></div>
    <ol v-else class="rotation-log secret-history">
      <li v-for="(rotation, index) in rotations" :key="rotation.id" class="rotation-log__entry">
        <span class="rotation-log__mark"><RefreshCw :size="12" aria-hidden="true" /></span>
        <div class="rotation-log__body">
          <p class="rotation-log__head">
            <strong>Rotated</strong>
            <time class="tabular" :datetime="rotation.rotatedAt">{{
              formatTime(rotation.rotatedAt)
            }}</time>
          </p>
          <p class="rotation-log__keys tabular">
            <span class="rotation-log__old">rlmi_{{ rotation.previousKeyId }}</span>
            <span aria-hidden="true">→</span>
            <span class="sr-only">replaced by</span>
            <span>rlmi_{{ rotation.newKeyId }}</span>
            <span v-if="index === 0" class="rotation-log__current">Current</span>
          </p>
          <p class="rotation-log__by">by {{ rotation.rotatedBy?.email ?? 'a deleted User' }}</p>
        </div>
      </li>
      <li class="rotation-log__entry rotation-log__entry--origin">
        <span class="rotation-log__mark"><Blocks :size="12" aria-hidden="true" /></span>
        <div class="rotation-log__body">
          <p class="rotation-log__head">
            <strong>Created</strong>
            <time class="tabular" :datetime="integration.createdAt">{{
              formatTime(integration.createdAt)
            }}</time>
          </p>
          <p class="rotation-log__by">by {{ integration.createdBy?.email ?? 'a deleted User' }}</p>
        </div>
      </li>
    </ol>
  </section>
</template>
