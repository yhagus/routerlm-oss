<script setup lang="ts">
import type { UpstreamModelProbe } from "~/composables/useUpstreamModelProbe";
import { attemptOutcomeLabel, upstreamErrorMessage } from "~/lib/errorCaptures";
import { ERROR_ORIGIN_LABELS } from "~/lib/errorOrigins";
import type { ProbeResult } from "~/lib/probe";
import { upstreamModelLabel } from "~/lib/upstream";
import { formatCost, formatDuration } from "~/lib/usage";

const props = defineProps<{
  probe: UpstreamModelProbe;
}>();
const isOpen = defineModel<boolean>("open", { required: true });

const title = computed(() => `Probe of ${upstreamModelLabel(props.probe.upstreamModel)}`);

function errorText(result: ProbeResult): string | null {
  if (result.errorMessage === null) return null;
  return upstreamErrorMessage(result.errorMessage) ?? result.errorMessage;
}

const results = computed(() =>
  props.probe.status === "done"
    ? props.probe.results.map((result) => ({ ...result, errorText: errorText(result) }))
    : [],
);
</script>

<template>
  <AppDialog
    v-model:open="isOpen"
    wide
    :title="title"
    description="One call with each enabled Provider Account, in priority order. Results aren't kept."
  >
    <p v-if="probe.status === 'refused'" class="form__error" role="alert">{{ probe.message }}</p>
    <p v-else-if="results.length === 0" class="field__note">No Provider Account was probed.</p>
    <ol v-else class="probe-results">
      <li v-for="result in results" :key="result.providerAccountId" class="probe-result">
        <p class="probe-result__head">
          <strong>{{ result.providerAccountName }}</strong>
          <span
            class="status-badge"
            :class="result.ok ? 'status-badge--good' : 'status-badge--bad'"
            >{{ attemptOutcomeLabel(result, result.ok ? "Succeeded" : "Failed") }}</span
          >
        </p>
        <p class="probe-result__facts tabular">
          <span>Latency {{ formatDuration(result.latencyMs) }}</span>
          <span v-if="result.ok">Cost {{ formatCost(result.cost) }}</span>
          <span v-if="result.errorOrigin">{{ ERROR_ORIGIN_LABELS[result.errorOrigin] }} error</span>
          <NuxtLink
            v-if="result.errorCaptureId"
            class="row-action"
            :to="`/error-captures/${result.errorCaptureId}`"
            target="_blank"
            title="Opens in a new tab. It is written a moment after the probe."
            >Error Capture</NuxtLink
          >
        </p>
        <p v-if="result.errorText" class="probe-result__error">{{ result.errorText }}</p>
      </li>
    </ol>
    <div class="dialog__actions">
      <button class="button button--primary" type="button" @click="isOpen = false">Done</button>
    </div>
  </AppDialog>
</template>
