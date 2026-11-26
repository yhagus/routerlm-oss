<script setup lang="ts">
import { ListFilter } from '@lucide/vue';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';

const props = defineProps<{
  activeCount: number;
}>();
const emit = defineEmits<{ clearAll: [] }>();

const hasActiveFilters = computed(() => props.activeCount > 0);
const buttonText = computed(() =>
  hasActiveFilters.value ? `Filters · ${props.activeCount}` : 'Filters',
);
const accessibleName = computed(() =>
  hasActiveFilters.value ? `Filters, ${props.activeCount} active` : 'Filters',
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
