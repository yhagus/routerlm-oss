<script setup lang="ts" generic="Id extends string">
import { Ellipsis } from "@lucide/vue";
import type { Component } from "vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/** One entry of the menu. A destructive one is drawn in the danger colour. */
export interface RowAction<Id extends string = string> {
  id: Id;
  label: string;
  icon: Component;
  isDestructive?: boolean;
}

/** A table row's actions behind one "…" button, so the row stays one line wide. */
defineProps<{
  /** What the button is for, such as "Actions for ada@example.com". */
  label: string;
  actions: RowAction<Id>[];
}>();
const emit = defineEmits<{ select: [id: Id] }>();

const ITEM_CLASS = "rounded-md py-2 text-xs text-(--ink-2) focus:bg-(--control-hover)";
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button class="icon-button row-actions-trigger" type="button" :aria-label="label">
        <Ellipsis :size="16" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      :side-offset="6"
      :collision-padding="12"
      class="min-w-[176px] rounded-xl border-(--line) bg-(--panel) p-1.5 shadow-[0_12px_32px_var(--shadow-pop-color)]"
    >
      <DropdownMenuItem
        v-for="action in actions"
        :key="action.id"
        :variant="action.isDestructive ? 'destructive' : 'default'"
        :class="[
          ITEM_CLASS,
          action.isDestructive && 'text-(--danger-ink) focus:text-(--danger-ink)',
        ]"
        @select="emit('select', action.id)"
      >
        <component :is="action.icon" :size="14" aria-hidden="true" />
        {{ action.label }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
