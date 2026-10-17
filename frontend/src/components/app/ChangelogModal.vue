<script setup lang="ts">
import { X } from "lucide-vue-next";
import Button from "@/components/ui/button.vue";
// Bundled at build time so the dialog matches the running version offline.
import content from "../../../../CHANGELOG.md?raw";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[70] grid place-items-center p-4"
    data-i18n-skip="true"
  >
    <button
      class="absolute inset-0 bg-black/40 backdrop-blur-sm"
      aria-label="Close changelog"
      @click="emit('close')"
    />
    <section
      class="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Change Log"
    >
      <header
        class="flex items-center justify-between border-b border-border px-4 py-3"
      >
        <h2 class="text-lg font-semibold">Change Log</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close changelog"
          @click="emit('close')"
          ><X class="size-4"
        /></Button>
      </header>
      <div class="min-h-36 overflow-y-auto p-6">
        <pre
          class="whitespace-pre-wrap break-words font-sans text-sm leading-6"
          >{{ content }}</pre>
      </div>
    </section>
  </div>
</template>
