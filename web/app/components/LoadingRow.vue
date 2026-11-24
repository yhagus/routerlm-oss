<script setup lang="ts">
defineProps<{
  columns: number;
  label?: string;
}>();
</script>

<template>
  <tr class="loading-row">
    <td :colspan="columns"><AppSpinner :label="label" /></td>
  </tr>
</template>
