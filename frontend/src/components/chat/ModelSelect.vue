<script setup lang="ts">
import { computed } from "vue";
import type { ModelItem } from "@/types/api";
import Combobox from "@/components/ui/combobox.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    models: ModelItem[];
    disabled?: boolean;
    emptyLabel?: string;
  }>(),
  {
    disabled: false,
    emptyLabel: "No models available",
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const options = computed(() =>
  props.models.map((model) => ({ value: model.id, label: model.id })),
);
</script>

<template>
  <Combobox
    v-bind="$attrs"
    :model-value="modelValue"
    :options="options"
    :disabled="disabled || models.length === 0"
    :placeholder="models.length ? 'Search models...' : emptyLabel"
    :empty-text="emptyLabel"
    class="min-w-0"
    @update:model-value="(value) => emit('update:modelValue', String(value))"
  />
</template>
