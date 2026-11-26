<script setup lang="ts" generic="Value extends string">
import { Check, ChevronDown, Search } from '@lucide/vue';
import {
  ListboxContent,
  ListboxFilter,
  ListboxItem,
  ListboxItemIndicator,
  ListboxRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui';

type SelectOption = { label: string; value: Value };

const MENU_OFFSET = 5;
const VIEWPORT_MARGIN = 12;

const props = withDefaults(
  defineProps<{
    modelValue: Value;
    options: SelectOption[];
    label: string;
    placeholder?: string;
    searchable?: boolean;
    menuClass?: string;
    menuAlign?: 'start' | 'end';
    emptyText?: string;
  }>(),
  {
    placeholder: 'Select an option',
    searchable: false,
    menuAlign: 'start',
    emptyText: 'No options yet',
  },
);
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>();

const open = ref(false);
const query = ref('');
const listbox = useTemplateRef('listbox');
const listId = useId();

const visibleOptions = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!props.searchable || needle === '') return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(needle));
});
const selectedLabel = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue)?.label ?? props.placeholder,
);

function handleOpenChange(isOpen: boolean): void {
  open.value = isOpen;
  if (!isOpen) query.value = '';
}

function handleOpenAutoFocus(event: Event): void {
  event.preventDefault();
  if (!props.searchable) void listbox.value?.highlightSelected();
}

function handleSelect(value: unknown): void {
  const option = props.options.find((each) => each.value === value);
  if (option) emit('update:modelValue', option.value);
  handleOpenChange(false);
}

function handleTriggerArrowKey(event: KeyboardEvent): void {
  event.preventDefault();
  handleOpenChange(true);
}
</script>

<template>
  <div class="app-select">
    <PopoverRoot :open="open" @update:open="handleOpenChange">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="select-control select-control--custom"
          :aria-label="label"
          aria-haspopup="listbox"
          @keydown.down.up="handleTriggerArrowKey"
        >
          <slot name="leading" />
          <span class="select-control__value">{{ selectedLabel }}</span>
          <span class="select-control__chevron"><ChevronDown :size="14" /></span>
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          class="app-select-content"
          :class="[{ 'app-select-content--searchable': searchable }, menuClass]"
          side="bottom"
          :align="menuAlign"
          :side-offset="MENU_OFFSET"
          :collision-padding="VIEWPORT_MARGIN"
          @open-auto-focus="handleOpenAutoFocus"
        >
          <ListboxRoot
            ref="listbox"
            class="app-select-listbox"
            :model-value="modelValue"
            selection-behavior="replace"
            highlight-on-hover
            @update:model-value="handleSelect"
          >
            <label v-if="searchable" class="app-select-search">
              <Search :size="13" aria-hidden="true" />
              <ListboxFilter
                v-model="query"
                auto-focus
                role="combobox"
                aria-autocomplete="list"
                :aria-expanded="true"
                :aria-controls="listId"
                :aria-label="`Search ${label}`"
                placeholder="Search…"
                spellcheck="false"
                autocomplete="off"
              />
            </label>
            <ListboxContent :id="listId" class="app-select-options" :aria-label="label">
              <ListboxItem
                v-for="option in visibleOptions"
                :key="option.value"
                :value="option.value"
                class="app-select-item"
              >
                <span class="app-select-item__content">
                  <slot name="option-leading" :option="option" />
                  <span class="app-select-item__label">{{ option.label }}</span>
                </span>
                <ListboxItemIndicator as-child>
                  <Check class="app-select-item__indicator" :size="14" />
                </ListboxItemIndicator>
              </ListboxItem>
              <p v-if="options.length === 0" class="app-select-empty">{{ emptyText }}</p>
              <p v-else-if="visibleOptions.length === 0" class="app-select-empty">
                No matches for “{{ query.trim() }}”
              </p>
            </ListboxContent>
          </ListboxRoot>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
