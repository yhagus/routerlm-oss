<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';

defineProps<{
  title: string;
  description: string;
  wide?: boolean;
  extraWide?: boolean;
  hideDescription?: boolean;
}>();
const isOpen = defineModel<boolean>('open', { required: true });
</script>

<template>
  <DialogRoot v-model:open="isOpen">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent
        class="dialog"
        :class="{ 'dialog--wide': wide || extraWide, 'dialog--extra-wide': extraWide }"
      >
        <DialogTitle class="dialog__title">{{ title }}</DialogTitle>
        <DialogDescription :class="hideDescription ? 'sr-only' : 'dialog__description'">{{
          description
        }}</DialogDescription>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
