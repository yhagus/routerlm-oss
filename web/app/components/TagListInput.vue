<script setup lang="ts">
import { X } from "@lucide/vue";
import {
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
  TagsInputRoot,
} from "reka-ui";

/**
 * A list of short values typed one at a time: Enter, a comma, a paste or
 * leaving the field adds what was typed as a tag; Backspace or a tag's ×
 * removes one. Duplicates are ignored.
 */
defineProps<{
  /** The field's accessible name. */
  label: string;
  placeholder?: string;
}>();
const values = defineModel<string[]>({ required: true });
</script>

<template>
  <TagsInputRoot v-model="values" class="tag-list-input" delimiter="," add-on-paste add-on-blur>
    <TagsInputItem v-for="value in values" :key="value" :value="value" class="tag">
      <TagsInputItemText />
      <TagsInputItemDelete class="tag-list-input__delete" :aria-label="`Remove ${value}`">
        <X :size="11" aria-hidden="true" />
      </TagsInputItemDelete>
    </TagsInputItem>
    <TagsInputInput
      class="tag-list-input__field"
      :placeholder="values.length === 0 ? placeholder : undefined"
      :aria-label="label"
      spellcheck="false"
      autocomplete="off"
    />
  </TagsInputRoot>
</template>
