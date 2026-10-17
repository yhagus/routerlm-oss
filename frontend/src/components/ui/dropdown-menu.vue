<script setup lang="ts">
import { computed, type Component } from "vue";
import { MoreHorizontal } from "lucide-vue-next";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";
import { cn } from "@/lib/utils";

export interface DropdownMenuAction {
  key: string;
  label: string;
  icon?: Component;
  disabled?: boolean;
  destructive?: boolean;
  hidden?: boolean;
  separatorBefore?: boolean;
}

const props = withDefaults(
  defineProps<{
    items: DropdownMenuAction[];
    align?: "start" | "center" | "end";
    triggerClass?: string;
    contentClass?: string;
    itemClass?: string;
  }>(),
  { align: "end" },
);

const emit = defineEmits<{ select: [key: string] }>();

const visibleItems = computed(() => props.items.filter((item) => !item.hidden));
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger">
        <button
          type="button"
          :class="
            cn(
              'inline-flex size-9 items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground',
              triggerClass,
            )
          "
          aria-label="Open actions menu"
        >
          <MoreHorizontal class="size-4" />
        </button>
      </slot>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :align="align"
        :side-offset="4"
        :class="
          cn(
            'z-50 min-w-40 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
            contentClass,
          )
        "
      >
        <template v-for="item in visibleItems" :key="item.key">
          <DropdownMenuSeparator
            v-if="item.separatorBefore"
            class="my-1 h-px bg-border"
          />
          <DropdownMenuItem
            :disabled="item.disabled"
            :class="
              cn(
                'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                item.destructive && 'text-destructive focus:text-destructive',
                itemClass,
              )
            "
            @select="emit('select', item.key)"
          >
            <component :is="item.icon" v-if="item.icon" class="size-3.5 shrink-0" />
            <span class="truncate">{{ item.label }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
