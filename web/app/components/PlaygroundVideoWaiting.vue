<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core';
import { computed, shallowRef } from 'vue';
import { Shimmer } from '@/components/ai-elements/shimmer';

const props = defineProps<{
  label: string;
  submittedAt: number;
  progress: number | null;
}>();

const SECONDS_PER_MINUTE = 60;
const TICK_MS = 1000;
const now = shallowRef(Date.now());
useIntervalFn(() => (now.value = Date.now()), TICK_MS);

const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - props.submittedAt) / 1000));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}`;
});

const line = computed(() => {
  const parts = [props.label, elapsed.value];
  if (props.progress !== null) parts.push(`${Math.round(props.progress)}%`);
  return `${parts.join(' · ')}…`;
});
</script>

<template>
  <Shimmer class="exchange__waiting" :duration="1.6">{{ line }}</Shimmer>
</template>
