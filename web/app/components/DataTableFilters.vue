<script setup lang="ts">
import { ListFilter } from "@lucide/vue";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

/**
 * The DataTable's Filters button and popover. The caller's filter fields go in
 * the default slot, stacked; they apply as they change.
 */
const props = defineProps<{
  /** How many filters are set; shown on the button as "Filters · 3", or a badge on phones. */
  activeCount: number;
}>();
const emit = defineEmits<{ clearAll: [] }>();

const hasActiveFilters = computed(() => props.activeCount > 0);
const buttonText = computed(() =>
  hasActiveFilters.value ? `Filters · ${props.activeCount}` : "Filters",
);
const accessibleName = computed(() =>
  hasActiveFilters.value ? `Filters, ${props.activeCount} active` : "Filters",
);
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        class="button data-table-tool"
        :class="{ 'data-table-tool--active': hasActiveFilters }"
        type="button"
        :aria-label="accessibleName"
      >
        <ListFilter :size="14" aria-hidden="true" />
        <span class="data-table-tool__label tabular" aria-hidden="true">{{ buttonText }}</span>
        <!-- Phones hide the label, so the count rides on the icon. -->
        <span v-if="hasActiveFilters" class="data-table-tool__count tabular" aria-hidden="true">
          {{ activeCount }}
        </span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      :side-offset="6"
      :collision-padding="12"
      class="w-[min(300px,calc(100vw-32px))] rounded-2xl border-(--line) bg-(--panel) p-0 shadow-[0_12px_32px_var(--shadow-pop-color)]"
    >
      <div class="data-table-filters" role="group" aria-label="Filters">
        <div class="data-table-filters__fields">
          <slot />
        </div>
        <div class="data-table-filters__footer">
          <button
            class="text-button"
            type="button"
            :disabled="!hasActiveFilters"
            @click="emit('clearAll')"
          >
            Clear all
          </button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
