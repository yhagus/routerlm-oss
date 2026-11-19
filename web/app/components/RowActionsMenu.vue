<script setup lang="ts" generic="Id extends string">
import { Ellipsis } from "@lucide/vue";
import type { Component } from "vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

/**
 * One entry of the menu. A destructive one is drawn in the danger colour, below
 * a separator. A disabled one stays listed with a `hint` saying why.
 */
export interface RowAction<Id extends string = string> {
  id: Id;
  label: string;
  icon: Component;
  isDestructive?: boolean;
  isDisabled?: boolean;
  /** A short line under the label, such as why the action is unavailable. */
  hint?: string;
}

/** A table row's actions behind one "…" button, so the row stays one line wide. */
const props = defineProps<{
  /** What the button is for, such as "Actions for ada@example.com". */
  label: string;
  actions: RowAction<Id>[];
}>();
const emit = defineEmits<{ select: [id: Id] }>();

const ITEM_CLASS = "rounded-md py-2 text-xs text-(--ink-2) focus:bg-(--control-hover)";

/** The first destructive action, which a separator sets apart from the rest. */
const firstDestructiveId = computed(
  () => props.actions.find((action, index) => index > 0 && action.isDestructive)?.id,
);
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
      class="min-w-[176px] max-w-[260px] rounded-xl border-(--line) bg-(--panel) p-1.5 shadow-[0_12px_32px_var(--shadow-pop-color)]"
    >
      <template v-for="action in actions" :key="action.id">
        <DropdownMenuSeparator
          v-if="action.id === firstDestructiveId"
          class="mx-1 my-1 bg-(--line-soft)"
        />
        <DropdownMenuItem
          :variant="action.isDestructive ? 'destructive' : 'default'"
          :disabled="action.isDisabled"
          :class="[
            ITEM_CLASS,
            action.hint && 'items-start',
            action.isDestructive && 'text-(--danger-ink) focus:text-(--danger-ink)',
          ]"
          @select="emit('select', action.id)"
        >
          <component
            :is="action.icon"
            :size="14"
            aria-hidden="true"
            :class="action.hint && 'mt-px'"
          />
          <span v-if="action.hint" class="row-action-item">
            {{ action.label }}
            <small class="row-action-item__hint">{{ action.hint }}</small>
          </span>
          <template v-else>{{ action.label }}</template>
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
