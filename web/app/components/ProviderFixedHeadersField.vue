<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue';
import { type FixedHeaderForm, fixedHeaderFormFor } from '~/lib/providerForm';

const headers = defineModel<FixedHeaderForm[]>({ required: true });

function rowLabel(header: FixedHeaderForm): string {
  return header.name.trim() === '' ? 'new header' : header.name.trim();
}

function handleAdd(): void {
  headers.value.push(fixedHeaderFormFor());
}

function handleRemove(header: FixedHeaderForm): void {
  headers.value = headers.value.filter((row) => row.key !== header.key);
}
</script>

<template>
  <fieldset class="header-list">
    <legend class="field__label">Fixed headers</legend>
    <div v-for="header in headers" :key="header.key" class="header-list__row">
      <input
        v-model="header.name"
        class="text-input header-list__input"
        aria-label="Header name"
        placeholder="Lowercase header name"
        spellcheck="false"
      />
      <input
        v-model="header.value"
        class="text-input header-list__input"
        :aria-label="`Value of ${rowLabel(header)}`"
        placeholder="Value"
        spellcheck="false"
      />
      <button
        class="icon-button"
        type="button"
        :aria-label="`Remove ${rowLabel(header)}`"
        @click="handleRemove(header)"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <button class="button header-list__add" type="button" @click="handleAdd">
      <Plus :size="14" /> Add header
    </button>
  </fieldset>
</template>
