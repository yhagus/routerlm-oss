<script setup lang="ts">
import { useMutationObserver } from "@vueuse/core";
import { onMounted, useTemplateRef } from "vue";

const table = useTemplateRef<HTMLTableElement>("table");

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
useMutationObserver(table, labelCells, { childList: true, subtree: true, characterData: true });
</script>

<template>
  <div class="ds-table">
    <table ref="table">
      <slot />
    </table>
  </div>
</template>
