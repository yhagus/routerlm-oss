<script setup lang="ts">
import Button from "@/components/ui/button.vue";
import Modal from "@/components/ui/modal.vue";

withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    loading?: boolean;
  }>(),
  {
    title: "Confirm",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    loading: false,
  },
);

const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <Modal
    :open="open"
    :title="title"
    size="sm"
    @close="!loading && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <p class="text-sm leading-relaxed text-muted-foreground">{{ message }}</p>
      <div class="flex gap-2">
        <Button
          variant="destructive"
          class="flex-1"
          :disabled="loading"
          @click="emit('confirm')"
          >{{ loading ? "Working..." : confirmText }}</Button
        >
        <Button
          variant="ghost"
          class="flex-1"
          :disabled="loading"
          @click="emit('close')"
          >{{ cancelText }}</Button
        >
      </div>
    </div>
  </Modal>
</template>
