<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  LoaderCircle,
  RotateCcw,
  Wrench,
} from "lucide-vue-next";
import type { ChatMessage } from "@/types/chat";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";

const props = withDefaults(
  defineProps<{
    messages: ChatMessage[];
    modelLabel: string;
    loading?: boolean;
    activity?: string;
    emptyTitle?: string;
    emptyDescription?: string;
    canRegenerate?: boolean;
  }>(),
  {
    loading: false,
    activity: "Working...",
    emptyTitle: "Start a conversation",
    emptyDescription:
      "Send a prompt through the local gateway to see the response here.",
    canRegenerate: false,
  },
);

const emit = defineEmits<{ regenerate: [] }>();

const copiedId = ref("");
// Reasoning stays open while the model thinks and folds away once the answer
// starts. A user toggle after streaming overrides that default.
const reasoningOpen = ref<Record<string, boolean>>({});
let copiedTimer: number | undefined;

const lastAssistantId = computed(
  () =>
    [...props.messages].reverse().find((message) => message.role === "assistant")
      ?.id || "",
);
// BasicChatView streams without a placeholder message, so the list shows
// its own pending row when the last message is not a streaming reply.
const showPendingRow = computed(() => {
  if (!props.loading) return false;
  const last = props.messages[props.messages.length - 1];
  return !(last?.role === "assistant" && last.status === "streaming");
});

async function copy(message: ChatMessage) {
  try {
    await navigator.clipboard.writeText(message.content);
  } catch {
    return;
  }
  copiedId.value = message.id;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => (copiedId.value = ""), 1500);
}

function seconds(ms?: number) {
  if (!ms) return "";
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

function isReasoningOpen(message: ChatMessage) {
  return (
    reasoningOpen.value[message.id] ??
    (message.status === "streaming" && !message.content)
  );
}

function setReasoningOpen(message: ChatMessage, open: boolean) {
  if (message.status === "streaming") return;
  reasoningOpen.value = { ...reasoningOpen.value, [message.id]: open };
}

function isWaiting(message: ChatMessage) {
  return (
    message.status === "streaming" && !message.content && !message.reasoning
  );
}
</script>

<template>
  <Conversation class="min-h-0 flex-1" aria-label="Conversation">
    <ConversationContent
      class="mx-auto min-h-full w-full max-w-3xl gap-7 px-4 py-6 sm:px-6"
    >
      <div
        v-if="messages.length === 0"
        class="flex flex-1 flex-col items-center justify-center py-10 text-center"
      >
        <slot name="empty">
          <h2 class="text-xl font-semibold tracking-tight">{{ emptyTitle }}</h2>
          <p class="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {{ emptyDescription }}
          </p>
        </slot>
      </div>

      <template v-for="message in messages" :key="message.id">
        <div
          v-if="message.role === 'user'"
          class="group flex flex-col items-end gap-1"
        >
          <div
            class="max-w-[min(85%,40rem)] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-sm leading-6"
          >
            <div
              v-if="message.attachments?.length"
              class="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              <a
                v-for="attachment in message.attachments"
                :key="attachment.id"
                :href="attachment.dataUrl"
                target="_blank"
                rel="noreferrer"
                class="overflow-hidden rounded-lg border border-border/70 bg-background"
              >
                <img
                  :src="attachment.dataUrl"
                  :alt="attachment.name"
                  class="h-24 w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </a>
            </div>
            <p class="whitespace-pre-wrap break-words">{{ message.content }}</p>
          </div>
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            :aria-label="copiedId === message.id ? 'Copied' : 'Copy message'"
            @click="copy(message)"
          >
            <Check v-if="copiedId === message.id" class="size-3" />
            <Copy v-else class="size-3" />
            {{ copiedId === message.id ? "Copied" : "Copy" }}
          </button>
        </div>

        <div v-else class="group flex gap-3">
          <div
            class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-primary"
          >
            <LoaderCircle
              v-if="message.status === 'streaming'"
              class="size-4 animate-spin"
            />
            <Bot v-else class="size-4" />
          </div>
          <div class="min-w-0 flex-1 space-y-3">
            <p class="pt-1 text-xs text-muted-foreground">
              <span class="font-medium text-foreground">{{
                message.model || modelLabel
              }}</span>
              <template v-if="message.durationMs">
                · {{ seconds(message.durationMs) }}</template
              >
            </p>

            <Reasoning
              v-if="message.reasoning"
              :is-streaming="message.status === 'streaming' && !message.content"
              :default-open="false"
              :open="isReasoningOpen(message)"
              class="mb-0"
              @update:open="setReasoningOpen(message, $event)"
            >
              <ReasoningTrigger />
              <ReasoningContent
                :content="message.reasoning"
                class="mt-2 border-l-2 border-border pl-3"
              />
            </Reasoning>

            <div v-if="message.tools?.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="tool in message.tools"
                :key="tool.id"
                :class="[
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]',
                  tool.status === 'error'
                    ? 'border-destructive/30 text-destructive'
                    : 'border-border text-muted-foreground',
                ]"
              >
                <LoaderCircle
                  v-if="tool.status === 'running'"
                  class="size-3 animate-spin"
                />
                <Wrench v-else class="size-3" />
                {{ tool.name }}
              </span>
            </div>

            <MessageResponse
              v-if="message.content"
              :content="message.content"
              class="h-auto text-sm leading-7"
            />
            <Shimmer v-else-if="isWaiting(message)" :duration="1">{{
              activity
            }}</Shimmer>
            <p
              v-else-if="message.status === 'done' && !message.reasoning"
              class="text-sm text-muted-foreground"
            >
              The model returned no text.
            </p>

            <div
              v-if="message.status === 'error'"
              class="flex flex-wrap items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle class="mt-0.5 size-4 shrink-0" />
              <span class="min-w-0 flex-1 break-words">{{
                message.error || "The gateway request failed."
              }}</span>
            </div>

            <div
              v-if="message.status !== 'streaming'"
              class="-ml-1.5 flex items-center gap-0.5 text-muted-foreground"
            >
              <button
                v-if="message.content"
                type="button"
                class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted hover:text-foreground"
                :aria-label="copiedId === message.id ? 'Copied' : 'Copy reply'"
                @click="copy(message)"
              >
                <Check v-if="copiedId === message.id" class="size-3.5" />
                <Copy v-else class="size-3.5" />
                {{ copiedId === message.id ? "Copied" : "Copy" }}
              </button>
              <button
                v-if="canRegenerate && message.id === lastAssistantId && !loading"
                type="button"
                class="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted hover:text-foreground"
                @click="emit('regenerate')"
              >
                <RotateCcw class="size-3.5" />
                {{ message.status === "error" ? "Retry" : "Regenerate" }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <div v-if="showPendingRow" class="flex items-center gap-3">
        <div
          class="grid size-7 place-items-center rounded-lg bg-accent text-primary"
        >
          <LoaderCircle class="size-4 animate-spin" />
        </div>
        <Shimmer :duration="1">{{ activity }}</Shimmer>
      </div>
    </ConversationContent>
    <ConversationScrollButton />
  </Conversation>
</template>
