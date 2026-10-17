<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    size?: "sm" | "md" | "lg" | "xl" | "full";
    closeOnOverlay?: boolean;
  }>(),
  { size: "md", closeOnOverlay: true },
);

const emit = defineEmits<{ close: [] }>();

const sizes = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  full: "max-w-4xl",
} as const;

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.open) emit("close");
}

watch(
  () => props.open,
  (value) => {
    document.body.style.overflow = value ? "hidden" : "";
  },
);
onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
  >
    <div
      class="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      @click="closeOnOverlay && emit('close')"
    />
    <div
      :class="
        cn(
          'relative flex w-full flex-col overflow-hidden rounded-[14px] border bg-background shadow-2xl',
          sizes[size],
        )
      "
    >
      <div
        class="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3"
      >
        <h2 class="text-sm font-semibold">{{ title }}</h2>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Close"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <div class="max-h-[75vh] overflow-y-auto p-4">
        <slot />
      </div>
      <div v-if="$slots.footer" class="shrink-0 border-t px-4 py-3">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
