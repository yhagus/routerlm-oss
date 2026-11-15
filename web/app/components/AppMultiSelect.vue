<script setup lang="ts" generic="Value extends string">
import { Check, ChevronDown } from "@lucide/vue";
import {
  ListboxContent,
  ListboxItem,
  ListboxRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from "reka-ui";

type SelectOption = { label: string; value: Value };

/** Picked options named in full on the trigger; more are counted instead. */
const MAX_NAMED_PICKS = 2;
/** Gap between the trigger and the menu, and the menu's margin from the viewport edge. */
const MENU_OFFSET = 5;
const VIEWPORT_MARGIN = 12;

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
    /** Menu text when there are no options at all; defaults to "No <noun> yet". */
    emptyText?: string;
  }>(),
  { match: "any" },
);
const emit = defineEmits<{ "update:modelValue": [value: Value[]] }>();

const open = ref(false);
const listbox = useTemplateRef("listbox");

const hasPicks = computed(() => props.modelValue.length > 0);
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

/** Emits the picks in option order; under "any", a full pick becomes no pick. */
function handlePicksChange(picked: unknown): void {
  const pickedValues: unknown[] = Array.isArray(picked) ? picked : [];
  const next = props.options
    .filter((option) => pickedValues.includes(option.value))
    .map((option) => option.value);
  const isEveryOptionPicked = props.options.length > 1 && next.length === props.options.length;
  emit("update:modelValue", props.match === "any" && isEveryOptionPicked ? [] : next);
}

/** Focus moves back to the list, since the Clear button disappears with the picks. */
function clearPicks(): void {
  emit("update:modelValue", []);
  void listbox.value?.highlightSelected();
}

/** The first picked option, or the first option, takes focus when the menu opens. */
function handleOpenAutoFocus(event: Event): void {
  event.preventDefault();
  void listbox.value?.highlightSelected();
}

/** Arrow keys open the menu, as they do on a native select. */
function handleTriggerArrowKey(event: KeyboardEvent): void {
  event.preventDefault();
  open.value = true;
}
</script>

<template>
  <div class="app-select">
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="select-control select-control--custom"
          :aria-label="`${label}: ${summary}`"
          :title="pickedLabels.length > MAX_NAMED_PICKS ? pickedLabels.join(', ') : undefined"
          aria-haspopup="listbox"
          @keydown.down.up="handleTriggerArrowKey"
        >
          <span class="select-control__value">{{ summary }}</span>
          <span class="select-control__chevron"><ChevronDown :size="14" /></span>
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          class="app-select-content app-select-content--multi"
          side="bottom"
          align="start"
          :side-offset="MENU_OFFSET"
          :collision-padding="VIEWPORT_MARGIN"
          @open-auto-focus="handleOpenAutoFocus"
        >
          <ListboxRoot
            ref="listbox"
            :model-value="modelValue"
            multiple
            highlight-on-hover
            @update:model-value="handlePicksChange"
          >
            <ListboxContent class="app-select-options" :aria-label="label">
              <ListboxItem
                v-for="option in options"
                :key="option.value"
                :value="option.value"
                class="app-select-item app-select-item--multi"
              >
                <span
                  class="app-select-check"
                  :class="{ 'app-select-check--on': isPicked(option) }"
                >
                  <Check v-if="isPicked(option)" :size="11" :stroke-width="3" aria-hidden="true" />
                </span>
                <span class="app-select-item__label">{{ option.label }}</span>
              </ListboxItem>
              <p v-if="options.length === 0" class="app-select-empty">
                {{ emptyText ?? `No ${noun} yet` }}
              </p>
            </ListboxContent>
          </ListboxRoot>
          <button
            v-if="hasPicks"
            type="button"
            class="app-select-item app-select-clear"
            @click="clearPicks"
          >
            Clear
          </button>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
