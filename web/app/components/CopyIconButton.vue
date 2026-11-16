<script setup lang="ts">
import { Check, Copy, X } from "@lucide/vue";
import { computed } from "vue";
import { useCopyFeedback } from "~/composables/useCopyFeedback";

/** A small icon button that copies `text` and shows the result in place. */
const props = defineProps<{
  text: string;
  /** What is copied, for the button's label: "model id". */
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
