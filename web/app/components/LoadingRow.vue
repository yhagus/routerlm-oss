<script setup lang="ts">
/** One table row with a centred spinner while a list loads. Use inside `<tbody>`. */
defineProps<{
  /** How many columns the row spans. */
  columns: number;
  label?: string;
}>();
</script>

<template>
  <tr class="loading-row">
    <td :colspan="columns"><AppSpinner :label="label" /></td>
  </tr>
</template>
