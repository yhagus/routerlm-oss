<script setup lang="ts">
defineProps<
  | { value: string; label: string; color: string; total?: false }
  | { value: string; label: string; total: true }
>();
</script>

<template>
  <span class="chart-tooltip__row" :class="{ 'chart-tooltip__total': total }"
    ><i v-if="!total" class="chart-key chart-key--line" :style="{ background: color }" /><strong>{{
      value
    }}</strong
    ><span>{{ label }}</span></span
  >
</template>
