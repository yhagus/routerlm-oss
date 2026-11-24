<script setup lang="ts">
import { Check, Copy, X } from "@lucide/vue";
import { computed } from "vue";
import { useCopyFeedback } from "~/composables/useCopyFeedback";

const props = defineProps<{
  text: string;
  label: string;
}>();

const { state, copy } = useCopyFeedback();

const title = computed(() => {
  if (state.value === "copied") return "Copied";
  if (state.value === "failed") return "Couldn't copy";
  return `Copy ${props.label}`;
});
</script>

<template>
  <button
    class="icon-action copy-icon-button"
    type="button"
    :aria-label="`Copy ${label} ${text}`"
    :title="title"
    @click.stop="copy(text)"
  >
    <Check v-if="state === 'copied'" :size="11" aria-hidden="true" />
    <X v-else-if="state === 'failed'" :size="11" aria-hidden="true" />
    <Copy v-else :size="11" aria-hidden="true" />
    <span class="sr-only" aria-live="polite">{{ state === "copied" ? "Copied" : "" }}</span>
  </button>
</template>
