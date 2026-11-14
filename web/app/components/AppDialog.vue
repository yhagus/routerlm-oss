<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";

// A modal panel with a title, a description and the caller's content (a form, buttons).
// `wide` fits longer forms, and scrolls when taller than the screen.
defineProps<{ title: string; description: string; wide?: boolean }>();
const isOpen = defineModel<boolean>("open", { required: true });
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog" :class="{ 'dialog--wide': wide }">
        <DialogTitle class="dialog__title">{{ title }}</DialogTitle>
        <DialogDescription class="dialog__description">{{ description }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
