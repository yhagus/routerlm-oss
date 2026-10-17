<script setup lang="ts">
import { computed } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";
import { cn } from "@/lib/utils";

defineOptions({ inheritAttrs: false });

type OptionValue = string | number;
type SelectOption = { value: OptionValue; label: string; disabled?: boolean };

const EMPTY_VALUE = "__shadcn_empty_value__";

const props = withDefaults(
  defineProps<{
    modelValue?: OptionValue | null;
    options?: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    class?: string;
    contentClass?: string;
  }>(),
  {
    options: () => [],
    placeholder: "Select an option",
    disabled: false,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: OptionValue | ""] }>();

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

const internalValue = computed<string>({
  get: () =>
    props.modelValue === "" && !hasEmptyOption()
      ? ""
      : encode(props.modelValue),
  set: (value) => emit("update:modelValue", decode(value)),
});

const selectedOptionLabel = computed(() => {
  if (props.modelValue === undefined || props.modelValue === null) return "";
  return (
    props.options.find(
      (option) => encode(option.value) === encode(props.modelValue),
    )?.label || ""
  );
});
</script>

<template>
  <div :class="cn('relative w-full', props.class)">
    <SelectRoot v-model="internalValue" :disabled="disabled">
      <SelectTrigger
        v-bind="$attrs"
        :class="
          cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-colors focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60',
            props.class,
          )
        "
      >
        <SelectValue :placeholder="placeholder" class="truncate">
          <span class="truncate">{{ selectedOptionLabel || placeholder }}</span>
        </SelectValue>
        <ChevronDown
          class="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </SelectTrigger>
      <SelectContent
        position="popper"
        side="bottom"
        align="start"
        :side-offset="4"
        :body-lock="false"
        :class="
          cn(
            'z-50 min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
            contentClass,
          )
        "
      >
        <SelectViewport class="max-h-72 p-1">
          <SelectItem
            v-for="option in options"
            :key="`${option.value}`"
            :value="encode(option.value)"
            :disabled="option.disabled"
            class="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground"
          >
            <span
              class="absolute left-2 flex size-4 items-center justify-center"
            >
              <SelectItemIndicator
                ><Check class="size-4"
              /></SelectItemIndicator>
            </span>
            <SelectItemText>{{ option.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectRoot>
  </div>
</template>
