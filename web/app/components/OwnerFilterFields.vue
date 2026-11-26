<script setup lang="ts">
import type { FilterOption } from '~/lib/queryFilters';

defineProps<{ integrationOptions: FilterOption[] }>();
const integrationIds = defineModel<string[]>('integrationIds', { required: true });
const customerId = defineModel<string>('customerId', { required: true });

const customerIdDraft = ref(customerId.value);
watch(customerId, (next) => {
  customerIdDraft.value = next;
});

function commitCustomerId(): void {
  customerId.value = customerIdDraft.value.trim();
}
</script>

<template>
  <div class="data-table-filter">
    <span class="data-table-filter__label" aria-hidden="true">Integration</span>
    <AppMultiSelect
      v-model="integrationIds"
      :options="integrationOptions"
      label="Filter by Integration"
      placeholder="All Integrations"
      noun="Integrations"
    />
  </div>
  <label class="data-table-filter">
    <span class="data-table-filter__label">Customer id</span>
    <input
      v-model="customerIdDraft"
      class="text-input"
      type="text"
      maxlength="200"
      placeholder="Any Customer"
      autocomplete="off"
      spellcheck="false"
      @change="commitCustomerId"
    />
  </label>
</template>
