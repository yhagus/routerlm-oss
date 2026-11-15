<script setup lang="ts" generic="Value extends string">
import { Check, ChevronDown, Search } from "@lucide/vue";

type SelectOption = { label: string; value: Value };

const props = withDefaults(
  defineProps<{
    modelValue: Value;
    options: SelectOption[];
    /** The control's accessible name (its aria-label). */
    label: string;
    placeholder?: string;
    /** Adds a filter field at the top of the menu, for long lists. */
    searchable?: boolean;
  }>(),
  { placeholder: "Select an option", searchable: false },
);
const emit = defineEmits<{ "update:modelValue": [value: Value] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const searchInput = ref<HTMLInputElement>();
const open = ref(false);
const highlightedIndex = ref(0);
const query = ref("");
const listId = useId();
/** The options the menu shows: all of them, or those whose label contains the query. */
const visibleOptions = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!props.searchable || needle === "") return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(needle));
});
watch(query, () => (highlightedIndex.value = 0));
const selectedLabel = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue)?.label ?? props.placeholder,
);

function closeMenu(refocus: boolean) {
  open.value = false;
  query.value = "";
  if (refocus) trigger.value?.focus();
}
function selectOption(option: SelectOption) {
  emit("update:modelValue", option.value);
  closeMenu(props.searchable);
}
async function openMenu() {
  query.value = "";
  highlightedIndex.value = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.modelValue),
  );
  open.value = true;
  if (props.searchable) {
    await nextTick();
    searchInput.value?.focus();
  }
}
function moveHighlight(direction: 1 | -1) {
  const count = visibleOptions.value.length;
  if (count === 0) return;
  highlightedIndex.value = (highlightedIndex.value + direction + count) % count;
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) return void openMenu();
    moveHighlight(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!open.value) return void openMenu();
    const highlighted = visibleOptions.value[highlightedIndex.value];
    if (highlighted) selectOption(highlighted);
  } else if (event.key === "Escape") closeMenu(false);
}
/** Keys in the filter field: arrows and Enter drive the list, Escape closes; the rest type. */
function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveHighlight(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const highlighted = visibleOptions.value[highlightedIndex.value];
    if (highlighted) selectOption(highlighted);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === "Tab") closeMenu(false);
}
function onDocumentPointerdown(event: PointerEvent) {
  if (!(event.target instanceof Node)) return;
  if (root.value && !root.value.contains(event.target)) closeMenu(false);
}
onMounted(() => document.addEventListener("pointerdown", onDocumentPointerdown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerdown));
</script>

<template>
  <div ref="root" class="app-select">
    <button
      ref="trigger"
      type="button"
      class="select-control select-control--custom"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open ? closeMenu(false) : openMenu()"
      @keydown="onKeydown"
    >
      <slot name="leading" />
      <span class="select-control__value">{{ selectedLabel }}</span>
      <span class="select-control__chevron"><ChevronDown :size="14" /></span>
    </button>
    <div
      v-if="open"
      class="app-select-content"
      :class="{ 'app-select-content--searchable': searchable }"
    >
      <label v-if="searchable" class="app-select-search">
        <Search :size="13" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="true"
          :aria-label="`Search ${label}`"
          :aria-activedescendant="
            visibleOptions[highlightedIndex] ? `${listId}-option-${highlightedIndex}` : undefined
          "
          placeholder="Search…"
          autocomplete="off"
          spellcheck="false"
          @keydown="onSearchKeydown"
        />
      </label>
      <div class="app-select-options" role="listbox" :aria-label="label">
        <button
          v-for="(option, index) in visibleOptions"
          :id="`${listId}-option-${index}`"
          :key="option.value"
          type="button"
          role="option"
          class="app-select-item"
          :class="{ 'app-select-item--highlighted': highlightedIndex === index }"
          :aria-selected="option.value === modelValue"
          :tabindex="searchable ? -1 : undefined"
          @mouseenter="highlightedIndex = index"
          @click="selectOption(option)"
        >
          <span class="app-select-item__label">{{ option.label }}</span>
          <Check v-if="option.value === modelValue" class="app-select-item__indicator" :size="14" />
        </button>
        <p v-if="visibleOptions.length === 0" class="app-select-empty">
          No matches for “{{ query.trim() }}”
        </p>
      </div>
    </div>
  </div>
</template>
