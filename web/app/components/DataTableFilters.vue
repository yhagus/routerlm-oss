<script setup lang="ts">
import { ListFilter } from "@lucide/vue";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";

/**
 * The DataTable's Filters button and popover. The caller's filter fields go in
 * the default slot, stacked; they apply as they change.
 */
const props = defineProps<{
  /** How many filters are set; shown on the button as "Filters · 3". */
  activeCount: number;
}>();
const emit = defineEmits<{ clearAll: [] }>();

const buttonText = computed(() =>
  props.activeCount > 0 ? `Filters · ${props.activeCount}` : "Filters",
);
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        class="button data-table-tool"
        :class="{ 'data-table-tool--active': activeCount > 0 }"
        type="button"
      >
        <ListFilter :size="14" aria-hidden="true" />
        <span class="data-table-tool__label tabular">{{ buttonText }}</span>
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
            :disabled="activeCount === 0"
            @click="emit('clearAll')"
          >
            Clear all
          </button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
