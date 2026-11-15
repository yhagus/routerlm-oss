<script setup lang="ts">
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import { formatCount } from "~/lib/usage";

/** "1,234 results · Page 2 of 25" with previous and next arrows. */
const props = defineProps<{
  rowCount: number;
  pageCount: number;
}>();
const page = defineModel<number>("page", { required: true });

const resultsLabel = computed(() => (props.rowCount === 1 ? "result" : "results"));
</script>

<template>
  <nav class="data-table-pagination" aria-label="Pagination">
    <span class="data-table-pagination__summary tabular"
      >{{ formatCount(rowCount) }} {{ resultsLabel }} · Page {{ page }} of {{ pageCount }}</span
    >
    <button
      class="icon-action data-table-pagination__arrow"
      type="button"
      aria-label="Previous page"
      title="Previous page"
      :disabled="page <= 1"
      @click="page -= 1"
    >
      <ChevronLeft :size="15" aria-hidden="true" />
    </button>
    <button
      class="icon-action data-table-pagination__arrow"
      type="button"
      aria-label="Next page"
      title="Next page"
      :disabled="page >= pageCount"
      @click="page += 1"
    >
      <ChevronRight :size="15" aria-hidden="true" />
    </button>
  </nav>
</template>
