<script setup lang="ts">
import {
  quotaMeterFill,
  quotaMeterRemaining,
  quotaMeterTone,
  resetCountdown,
} from '~/lib/quotaMeters';
import type { QuotaMeter } from '~/lib/upstream';

const props = defineProps<{
  meter: QuotaMeter;
  now: number;
  isCompact?: boolean;
}>();

const remaining = computed(() => quotaMeterRemaining(props.meter));
const countdown = computed(() => resetCountdown(props.meter.resetsAt, props.now));
const summary = computed(() =>
  countdown.value ? `${remaining.value} · ${countdown.value}` : remaining.value,
);
</script>

<template>
  <div class="quota-meter" :class="{ 'quota-meter--compact': isCompact }">
    <div class="quota-meter__caption">
      <span class="quota-meter__label">{{ meter.label }}</span>
      <span class="quota-meter__summary tabular">{{ summary }}</span>
    </div>
    <div
      class="quota-meter__track"
      role="meter"
      :aria-label="`${meter.label} remaining`"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="quotaMeterFill(meter)"
      :aria-valuetext="summary"
    >
      <span
        class="quota-meter__fill"
        :class="`quota-meter__fill--${quotaMeterTone(meter)}`"
        :style="{ width: `${quotaMeterFill(meter)}%` }"
      />
    </div>
  </div>
</template>
