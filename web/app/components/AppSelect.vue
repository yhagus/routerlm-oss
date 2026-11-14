<script setup lang="ts" generic="Value extends string">
import { Check, ChevronDown } from "@lucide/vue";

type SelectOption = { label: string; value: Value };

const props = withDefaults(
  defineProps<{
    modelValue: Value;
    options: SelectOption[];
    /** The control's accessible name (its aria-label). */
    label: string;
    placeholder?: string;
  }>(),
  { placeholder: "Select an option" },
);
const emit = defineEmits<{ "update:modelValue": [value: Value] }>();
const root = ref<HTMLElement>();
const open = ref(false);
const highlightedIndex = ref(0);
const selectedLabel = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue)?.label ?? props.placeholder,
);

function selectOption(option: SelectOption) {
  emit("update:modelValue", option.value);
  open.value = false;
}
function openMenu() {
  highlightedIndex.value = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.modelValue),
  );
  open.value = true;
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) return openMenu();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    highlightedIndex.value =
      (highlightedIndex.value + direction + props.options.length) % props.options.length;
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!open.value) return openMenu();
    const highlighted = props.options[highlightedIndex.value];
    if (highlighted) selectOption(highlighted);
  } else if (event.key === "Escape") open.value = false;
}
function onDocumentPointerdown(event: PointerEvent) {
  if (!(event.target instanceof Node)) return;
  if (root.value && !root.value.contains(event.target)) open.value = false;
}
onMounted(() => document.addEventListener("pointerdown", onDocumentPointerdown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerdown));
</script>

<template>
  <div ref="root" class="app-select">
    <button
      type="button"
      class="select-control select-control--custom"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open ? (open = false) : openMenu()"
      @keydown="onKeydown"
    >
      <slot name="leading" />
      <span class="select-control__value">{{ selectedLabel }}</span>
      <span class="select-control__chevron"><ChevronDown :size="14" /></span>
    </button>
    <div v-if="open" class="app-select-content" role="listbox" :aria-label="label">
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        class="app-select-item"
        :class="{ 'app-select-item--highlighted': highlightedIndex === index }"
        :aria-selected="option.value === modelValue"
        @mouseenter="highlightedIndex = index"
        @click="selectOption(option)"
      >
        <span>{{ option.label }}</span>
        <Check v-if="option.value === modelValue" class="app-select-item__indicator" :size="14" />
      </button>
    </div>
  </div>
</template>
