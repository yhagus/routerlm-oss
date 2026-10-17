<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ until: string | null }>();

const nowMs = ref(Date.now());
let timer: number | undefined;

const remaining = computed(() => {
  if (!props.until) return "";
  const diff = new Date(props.until).getTime() - nowMs.value;
  if (diff <= 0) return "";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return `${hrs}h ${mins}m`;
});

function restart() {
  if (timer) window.clearInterval(timer);
  if (props.until)
    timer = window.setInterval(() => {
      nowMs.value = Date.now();
    }, 1000);
}

watch(() => props.until, restart, { immediate: true });
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <span v-if="remaining" class="font-mono text-xs text-orange-500"
    >⏱ {{ remaining }}</span
  >
</template>
