<script setup lang="ts">
import { useMutationObserver } from "@vueuse/core";
import { onMounted, useTemplateRef } from "vue";

const table = useTemplateRef<HTMLTableElement>("table");

/**
 * Gives every body cell its column's header as `data-label`: phones stack the
 * table into one record per row and print that label above each cell.
 */
function labelCells(): void {
  if (!table.value) return;
  const headers = Array.from(table.value.querySelectorAll("thead th"), (header) =>
    (header.textContent ?? "").trim(),
  );
  for (const row of Array.from(table.value.querySelectorAll("tbody tr"))) {
    Array.from(row.children).forEach((cell, columnIndex) => {
      cell.setAttribute("data-label", headers[columnIndex] ?? "");
    });
  }
}

onMounted(labelCells);
// The rows are slotted content, which can re-render without this component updating.
useMutationObserver(table, labelCells, { childList: true, subtree: true, characterData: true });
</script>

<template>
  <!-- Wide screens scroll a wide table; phones stack it into ruled records. -->
  <div class="ds-table">
    <table ref="table">
      <slot />
    </table>
  </div>
</template>
