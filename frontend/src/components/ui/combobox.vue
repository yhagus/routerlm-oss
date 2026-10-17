<script setup lang="ts">
import { computed, onActivated, ref, watch } from "vue";
import { Check, ChevronsUpDown } from "lucide-vue-next";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";
import { cn } from "@/lib/utils";

defineOptions({ inheritAttrs: false });

type OptionValue = string | number;
type ComboboxOption = { value: OptionValue; label: string; disabled?: boolean };

const EMPTY_VALUE = "__shadcn_empty_value__";

const props = withDefaults(
  defineProps<{
    modelValue?: OptionValue | null;
    options?: ComboboxOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    loading?: boolean;
    disabled?: boolean;
    remote?: boolean;
    allowCustom?: boolean;
    class?: string;
    contentClass?: string;
  }>(),
  {
    options: () => [],
    placeholder: "Select an option",
    searchPlaceholder: "Search...",
    emptyText: "No results found.",
    loading: false,
    disabled: false,
    remote: false,
    allowCustom: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: OptionValue | ""];
  search: [value: string];
}>();

const searchValue = ref("");

function encode(value: OptionValue | null | undefined): string {
  if (value === "" || value === null || value === undefined) return EMPTY_VALUE;
  return String(value);
}

function hasEmptyOption() {
  return props.options.some((option) => option.value === "");
}

function decode(value: string): OptionValue | "" {
  if (value === EMPTY_VALUE) return "";
  return (
    props.options.find((option) => encode(option.value) === value)?.value ??
    value
  );
}

function selectedLabel(value: unknown): string {
  const encoded = String(value ?? "");
  return (
    props.options.find((option) => encode(option.value) === encoded)?.label ||
    (props.allowCustom && encoded !== EMPTY_VALUE ? encoded : "")
  );
}

const internalValue = computed<string>({
  get: () =>
    props.modelValue === "" && !hasEmptyOption()
      ? ""
      : encode(props.modelValue),
  set: (value) => emit("update:modelValue", decode(value)),
});

// Reka refreshes the input text only when the selected value changes. A label
// can change on its own (options load late, a loading label resolves), and a
// KeepAlive page can return with stale text. Re-sync the closed input then.
const anchor = ref<{ $el?: HTMLElement } | null>(null);
const currentLabel = computed(() => selectedLabel(internalValue.value));

function syncDisplay() {
  if (props.allowCustom) return;
  const input = anchor.value?.$el?.querySelector("input");
  if (input && document.activeElement === input) return;
  if (searchValue.value !== currentLabel.value)
    searchValue.value = currentLabel.value;
}

watch(currentLabel, syncDisplay);
onActivated(syncDisplay);

watch(searchValue, (value) => {
  emit("search", value);
  if (props.allowCustom && value !== selectedLabel(internalValue.value))
    emit("update:modelValue", value);
});
</script>

<template>
  <div :class="cn('relative', props.class)">
    <ComboboxRoot
      v-model="internalValue"
      :disabled="disabled"
      :ignore-filter="remote"
      :open-on-click="true"
      :open-on-focus="true"
      :reset-search-term-on-blur="!allowCustom"
      :reset-search-term-on-select="true"
    >
      <ComboboxAnchor ref="anchor" class="relative block w-full">
        <ComboboxInput
          v-bind="$attrs"
          v-model="searchValue"
          :display-value="selectedLabel"
          :placeholder="placeholder"
          :disabled="disabled"
          :class="
            cn(
              'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pr-9 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60',
              props.class,
            )
          "
          :aria-label="$attrs['aria-label']"
        />
        <ComboboxTrigger
          tabindex="-1"
          :disabled="disabled"
          class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground outline-none"
          aria-label="Toggle options"
        >
          <ChevronsUpDown class="size-4" aria-hidden="true" />
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxContent
        position="popper"
        :class="
          cn(
            'z-50 mt-1 min-w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
            contentClass,
          )
        "
      >
        <ComboboxViewport class="max-h-72 overflow-auto p-1">
          <ComboboxEmpty
            class="px-2 py-6 text-center text-sm text-muted-foreground"
          >
            {{ loading ? "Loading..." : emptyText }}
          </ComboboxEmpty>
          <ComboboxItem
            v-for="option in options"
            :key="`${option.value}`"
            :value="encode(option.value)"
            :text-value="option.label"
            :disabled="option.disabled"
            class="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground"
          >
            <span
              class="absolute left-2 flex size-4 items-center justify-center"
            >
              <ComboboxItemIndicator
                ><Check class="size-4"
              /></ComboboxItemIndicator>
            </span>
            <span class="truncate">{{ option.label }}</span>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxRoot>
  </div>
</template>
