<script setup lang="ts">
import { X } from "@lucide/vue";
import type { ActiveFilter } from "~/lib/activeFilters";

defineProps<{ filters: ActiveFilter[] }>();
const emit = defineEmits<{ clearAll: [] }>();
</script>

<template>
  <div v-if="filters.length" class="active-filters" role="group" aria-label="Active filters">
    <span v-for="filter in filters" :key="filter.key" class="active-filters__token">
      <span class="active-filters__group">{{ filter.group }}:</span>
      <span class="active-filters__label">{{ filter.label }}</span>
      <button
        type="button"
        class="active-filters__remove"
        :aria-label="`Remove ${filter.group}: ${filter.label}`"
        :title="`Remove ${filter.group}: ${filter.label}`"
        @click="filter.remove()"
      >
        <X :size="12" aria-hidden="true" />
      </button>
    </span>
    <button type="button" class="text-button active-filters__clear" @click="emit('clearAll')">
      Clear all
    </button>
  </div>
</template>
