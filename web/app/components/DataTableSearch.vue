<script setup lang="ts">
import { Search, X } from '@lucide/vue';

defineProps<{
  label: string;
  placeholder: string;
}>();
const text = defineModel<string>({ required: true });

const input = useTemplateRef('input');

function handleClear(): void {
  text.value = '';
  input.value?.focus();
}
</script>

<template>
  <label class="search-control data-table-search">
    <Search :size="14" aria-hidden="true" />
    <input
      ref="input"
      v-model="text"
      type="search"
      :placeholder="placeholder"
      :aria-label="label"
    />
    <button
      v-if="text"
      type="button"
      class="data-table-search__clear"
      aria-label="Clear search"
      title="Clear search"
      @click="handleClear"
    >
      <X :size="13" aria-hidden="true" />
    </button>
  </label>
</template>
