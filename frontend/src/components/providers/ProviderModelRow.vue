<script setup lang="ts">
import { computed, ref } from "vue";
import CapacityBadges from "@/components/providers/CapacityBadges.vue";

const props = defineProps<{
  model: { id: string; name?: string };
  fullModel: string;
  alias?: string | null;
  isCustom?: boolean;
  isFree?: boolean;
  testStatus?: "ok" | "error" | null;
  isTesting?: boolean;
  canTest?: boolean;
  caps?: Record<string, unknown> | null;
  thinkingSuffix?: string | null;
}>();
const emit = defineEmits<{
  copy: [];
  test: [];
  deleteAlias: [];
  disable: [];
  edit: [];
}>();

const copied = ref(false);
const displayModel = computed(() =>
  props.thinkingSuffix
    ? `${props.fullModel}(${props.thinkingSuffix})`
    : props.fullModel,
);
const borderColor = computed(() =>
  props.testStatus === "ok"
    ? "border-success/40"
    : props.testStatus === "error"
      ? "border-destructive/40"
      : "border-border",
);
const iconColor = computed(() =>
  props.testStatus === "ok"
    ? "text-success"
    : props.testStatus === "error"
      ? "text-destructive"
      : "text-muted-foreground",
);

async function copy() {
  try {
    await navigator.clipboard?.writeText(displayModel.value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <div
    class="group flex max-w-full min-w-0 flex-col rounded-[10px] border bg-card transition-colors hover:border-primary/40"
    :class="borderColor"
  >
    <!-- Info row: full width for the model id and capabilities -->
    <div class="flex min-w-0 items-start gap-2.5 px-3 pb-2.5 pt-3">
      <span
        class="material-symbols-outlined mt-0.5 shrink-0"
        :class="iconColor"
        >{{
          testStatus === "ok"
            ? "check_circle"
            : testStatus === "error"
              ? "cancel"
              : "smart_toy"
        }}</span
      >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <code
          class="block truncate font-mono text-xs font-medium"
          :title="displayModel"
          >{{ displayModel }}</code
        >
        <span
          v-if="model.name || caps"
          class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
        >
          <span
            v-if="model.name"
            class="truncate text-[11px] text-muted-foreground"
            >{{ model.name }}</span
          >
          <CapacityBadges
            :caps="caps"
            color-override="text-muted-foreground"
            :size="12"
          />
        </span>
      </div>
    </div>

    <!-- Toolbar row: actions sit below so the info row keeps the full width -->
    <div class="flex items-center gap-1 border-t border-border/60 px-2 py-1">
      <button
        v-if="canTest"
        type="button"
        class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-50"
        :disabled="isTesting"
        :title="isTesting ? 'Testing...' : 'Test'"
        @click="emit('test')"
      >
        <span
          class="material-symbols-outlined"
          :class="{ 'animate-spin': isTesting }"
          >{{ isTesting ? "progress_activity" : "science" }}</span
        >Test
      </button>
      <button
        type="button"
        class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
        :title="copied ? 'Copied!' : 'Copy'"
        @click="copy"
      >
        <span class="material-symbols-outlined">{{
          copied ? "check" : "content_copy"
        }}</span
        >{{ copied ? "Copied" : "Copy" }}
      </button>
      <button
        type="button"
        class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
        title="Edit capabilities"
        @click="emit('edit')"
      >
        <span class="material-symbols-outlined">edit</span>Edit
      </button>
      <button
        v-if="isCustom"
        type="button"
        class="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        title="Remove custom model"
        @click="emit('deleteAlias')"
      >
        <span class="material-symbols-outlined">delete</span>Remove
      </button>
      <button
        v-else
        type="button"
        class="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        title="Disable this model"
        @click="emit('disable')"
      >
        <span class="material-symbols-outlined">block</span>Disable
      </button>
    </div>
  </div>
</template>
