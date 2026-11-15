<script setup lang="ts">
import {
  quotaMeterFill,
  quotaMeterRemaining,
  quotaMeterTone,
  resetCountdown,
} from "~/lib/quotaMeters";
import type { QuotaMeter } from "~/lib/upstream";

/** One Quota Meter: "5h 75% · resets in 1h 37m" over a bar colored by what is left. */
const props = defineProps<{
  meter: QuotaMeter;
  /** The time countdowns count from, in epoch milliseconds. */
  now: number;
  /** Smaller, for scoped meters such as `weekly:video`. */
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
