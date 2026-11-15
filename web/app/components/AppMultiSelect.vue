<script setup lang="ts" generic="Value extends string">
import { Check, ChevronDown } from "@lucide/vue";

type SelectOption = { label: string; value: Value };

/** Picked options named in full on the trigger; more are counted instead. */
const MAX_NAMED_PICKS = 2;

const props = withDefaults(
  defineProps<{
    modelValue: Value[];
    options: SelectOption[];
    /** The control's accessible name. */
    label: string;
    /** Trigger text while nothing is picked, such as "Any capability". */
    placeholder: string;
    /** Plural noun for a count on the trigger, such as "capabilities" in "3 capabilities". */
    noun: string;
    /**
     * How the caller combines the picks. With "any", picking every option
     * filters nothing, so it is emitted as no pick. With "all" (a model must
     * have every picked capability), a full pick still narrows the list.
     */
    match?: "any" | "all";
  }>(),
  { match: "any" },
);
const emit = defineEmits<{ "update:modelValue": [value: Value[]] }>();

const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const listboxId = useId();
const open = ref(false);
/** Index into the options; one past the last is the Clear row. */
const highlightedIndex = ref(0);

const hasPicks = computed(() => props.modelValue.length > 0);
const rowCount = computed(() => props.options.length + (hasPicks.value ? 1 : 0));
const isClearHighlighted = computed(
  () => hasPicks.value && highlightedIndex.value === props.options.length,
);

const pickedLabels = computed(() =>
  props.options.filter((option) => isPicked(option)).map((option) => option.label),
);
const summary = computed(() => {
  const count = pickedLabels.value.length;
  if (count === 0) return props.placeholder;
  if (count <= MAX_NAMED_PICKS) return pickedLabels.value.join(", ");
  return `${count} ${props.noun}`;
});

function isPicked(option: SelectOption): boolean {
  return props.modelValue.includes(option.value);
}

function toggleOption(option: SelectOption): void {
  const next = props.options
    .filter((each) => (each === option ? !isPicked(each) : isPicked(each)))
    .map((each) => each.value);
  const isEveryOptionPicked = props.options.length > 1 && next.length === props.options.length;
  emit("update:modelValue", props.match === "any" && isEveryOptionPicked ? [] : next);
}

function clearPicks(): void {
  emit("update:modelValue", []);
  highlightedIndex.value = Math.min(highlightedIndex.value, props.options.length - 1);
}

function openMenu(): void {
  highlightedIndex.value = Math.max(0, props.options.findIndex(isPicked));
  open.value = true;
}
function closeMenu(): void {
  open.value = false;
  trigger.value?.focus();
}

function activateHighlighted(): void {
  if (isClearHighlighted.value) return clearPicks();
  const highlighted = props.options[highlightedIndex.value];
  if (highlighted) toggleOption(highlighted);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) return openMenu();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    highlightedIndex.value = (highlightedIndex.value + direction + rowCount.value) % rowCount.value;
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!open.value) return openMenu();
    activateHighlighted();
  } else if (event.key === "Escape" && open.value) {
    event.preventDefault();
    closeMenu();
  } else if (event.key === "Tab") open.value = false;
}

function handleDocumentPointerdown(event: PointerEvent): void {
  if (!(event.target instanceof Node)) return;
  if (root.value && !root.value.contains(event.target)) open.value = false;
}
onMounted(() => document.addEventListener("pointerdown", handleDocumentPointerdown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", handleDocumentPointerdown));

function optionId(index: number): string {
  return `${listboxId}-option-${index}`;
}
const activeDescendant = computed(() =>
  open.value && !isClearHighlighted.value ? optionId(highlightedIndex.value) : undefined,
);
</script>

<template>
  <div ref="root" class="app-select">
    <button
      ref="trigger"
      type="button"
      class="select-control select-control--custom"
      :aria-label="`${label}: ${summary}`"
      :aria-expanded="open"
      :aria-controls="open ? listboxId : undefined"
      :aria-activedescendant="activeDescendant"
      :title="pickedLabels.length > MAX_NAMED_PICKS ? pickedLabels.join(', ') : undefined"
      aria-haspopup="listbox"
      @click="open ? (open = false) : openMenu()"
      @keydown="handleKeydown"
    >
      <span class="select-control__value">{{ summary }}</span>
      <span class="select-control__chevron"><ChevronDown :size="14" /></span>
    </button>
    <!-- Rows keep focus on the trigger (mousedown.prevent), so the keyboard keeps working after a click. -->
    <div v-if="open" class="app-select-content app-select-content--multi">
      <div :id="listboxId" role="listbox" :aria-label="label" aria-multiselectable="true">
        <div
          v-for="(option, index) in options"
          :id="optionId(index)"
          :key="option.value"
          role="option"
          class="app-select-item app-select-item--multi"
          :class="{ 'app-select-item--highlighted': highlightedIndex === index }"
          :aria-selected="isPicked(option)"
          @mouseenter="highlightedIndex = index"
          @mousedown.prevent
          @click="toggleOption(option)"
        >
          <span class="app-select-check" :class="{ 'app-select-check--on': isPicked(option) }">
            <Check v-if="isPicked(option)" :size="11" :stroke-width="3" aria-hidden="true" />
          </span>
          <span class="app-select-item__label">{{ option.label }}</span>
        </div>
      </div>
      <button
        v-if="hasPicks"
        type="button"
        tabindex="-1"
        class="app-select-item app-select-clear"
        :class="{ 'app-select-item--highlighted': isClearHighlighted }"
        @mouseenter="highlightedIndex = options.length"
        @mousedown.prevent
        @click="clearPicks"
      >
        Clear
      </button>
    </div>
  </div>
</template>
