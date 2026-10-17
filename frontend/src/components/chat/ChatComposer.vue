<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ArrowUp, Paperclip, Square, X } from "lucide-vue-next";
import type { ChatAttachment } from "@/types/chat";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    modelLabel: string;
    disabled?: boolean;
    loading?: boolean;
    attachments?: ChatAttachment[];
    allowAttachments?: boolean;
    error?: string;
    placeholder?: string;
  }>(),
  {
    disabled: false,
    loading: false,
    attachments: () => [],
    allowAttachments: false,
    error: "",
    placeholder: "Message the gateway",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [];
  stop: [];
  attach: [files: FileList];
  removeAttachment: [id: string];
}>();
const fileInput = ref<HTMLInputElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);

function resize() {
  const element = textarea.value;
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
}

watch(
  () => props.modelValue,
  () => nextTick(resize),
);

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.loading) {
    event.preventDefault();
    event.stopPropagation();
    emit("stop");
    return;
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!props.loading) emit("send");
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) emit("attach", input.files);
  input.value = "";
}

function openFilePicker() {
  fileInput.value?.click();
}

function focus() {
  textarea.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <div class="bg-card px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
    <div class="mx-auto w-full max-w-3xl">
      <div
        v-if="error"
        class="mb-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        {{ error }}
      </div>
      <div
        class="rounded-2xl border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
      >
        <div
          v-if="attachments.length"
          class="flex flex-wrap gap-2 px-3 pt-3"
        >
          <div
            v-for="attachment in attachments"
            :key="attachment.id"
            class="flex max-w-56 items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs"
          >
            <span class="truncate">{{ attachment.name }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              aria-label="Remove attachment"
              @click="emit('removeAttachment', attachment.id)"
            >
              <X class="size-3.5" />
            </button>
          </div>
        </div>
        <label for="chat-composer-input" class="sr-only">Message</label>
        <textarea
          id="chat-composer-input"
          ref="textarea"
          :value="modelValue"
          :disabled="disabled"
          rows="1"
          class="block max-h-60 min-h-12 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          :placeholder="placeholder"
          @input="
            emit(
              'update:modelValue',
              ($event.target as HTMLTextAreaElement).value,
            )
          "
          @keydown="onKeydown"
        />
        <div class="flex items-center justify-between gap-2 px-2 pb-2">
          <div
            class="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <button
              v-if="allowAttachments"
              type="button"
              class="grid size-8 place-items-center rounded-md hover:bg-muted disabled:opacity-50"
              :disabled="disabled || loading"
              aria-label="Attach images"
              @click="openFilePicker"
            >
              <Paperclip class="size-4" />
            </button>
            <input
              v-if="allowAttachments"
              ref="fileInput"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="onFileChange"
            />
            <slot name="toolbar">
              <span class="truncate px-1">{{
                modelLabel || "No model selected"
              }}</span>
            </slot>
          </div>
          <button
            v-if="loading"
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background hover:opacity-90"
            aria-label="Stop response"
            title="Stop (Esc)"
            @click="emit('stop')"
          >
            <Square class="size-3 fill-current" />
          </button>
          <button
            v-else
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="disabled || (!modelValue.trim() && !attachments.length)"
            aria-label="Send message"
            title="Send (Enter)"
            @click="emit('send')"
          >
            <ArrowUp class="size-4" />
          </button>
        </div>
      </div>
      <p class="mt-1.5 text-center text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line<template v-if="loading">
          · Esc to stop</template
        >
      </p>
    </div>
  </div>
</template>
