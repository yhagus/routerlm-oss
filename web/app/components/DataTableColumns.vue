<script setup lang="ts">
import { Columns3 } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import type { HideableColumn } from '~/lib/dataTable';

defineProps<{ columns: HideableColumn[] }>();
const emit = defineEmits<{
  toggle: [columnId: string, isVisible: boolean];
  reset: [];
}>();

const ITEM_CLASS = 'rounded-md py-2 text-xs text-(--ink-2) focus:bg-(--control-hover)';
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button class="button data-table-tool" type="button">
        <Columns3 :size="14" aria-hidden="true" />
        <span class="data-table-tool__label">Columns</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      :side-offset="6"
      :collision-padding="12"
      class="min-w-[184px] rounded-xl border-(--line) bg-(--panel) p-1.5 shadow-[0_12px_32px_var(--shadow-pop-color)]"
    >
      <DropdownMenuCheckboxItem
        v-for="column in columns"
        :key="column.id"
        :model-value="column.isVisible"
        :class="ITEM_CLASS"
        @select.prevent
        @update:model-value="(isVisible: boolean) => emit('toggle', column.id, isVisible)"
      >
        {{ column.label }}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator class="bg-(--line-soft)" />
      <DropdownMenuItem :class="ITEM_CLASS" @select="emit('reset')">Reset columns</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
