<script setup lang="ts">
// Set or clear the per-connection max concurrent requests on a selection.
import { ref, watch } from "vue";
import Modal from "@/components/ui/modal.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";

const props = defineProps<{
  open: boolean;
  count: number;
  applying: boolean;
}>();
const emit = defineEmits<{
  close: [];
  // null clears the limit (no concurrency limit).
  apply: [limit: number | null];
}>();

const value = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) value.value = "";
  },
);

function parsedLimit(): number | null {
  const limit = Math.floor(Number(value.value));
  return Number.isFinite(limit) && limit >= 1 ? limit : null;
}

function close() {
  if (!props.applying) emit("close");
}
</script>

<template>
  <Modal
    :open="open"
    :title="`Max Concurrent (${count} selected)`"
    @close="close"
  >
    <div class="flex flex-col gap-3">
      <div class="space-y-2">
        <label class="text-sm font-medium" for="bulk-max-in-flight"
          >Max concurrent requests per account</label
        >
        <Input
          id="bulk-max-in-flight"
          v-model="value"
          type="number"
          min="1"
          placeholder="No limit"
        />
        <p class="text-xs text-muted-foreground">
          A full account sends new requests to the next account. Clear limit
          returns to the provider default, or no limit when none is set.
        </p>
      </div>
      <div class="flex gap-2">
        <Button
          class="flex-1"
          :disabled="applying || parsedLimit() === null"
          @click="emit('apply', parsedLimit())"
          >{{ applying ? "Applying..." : "Apply" }}</Button
        >
        <Button
          class="flex-1"
          variant="secondary"
          :disabled="applying"
          @click="emit('apply', null)"
          >Clear limit</Button
        >
      </div>
      <Button variant="ghost" class="w-full" :disabled="applying" @click="close"
        >Cancel</Button
      >
    </div>
  </Modal>
</template>
