<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { Play, Square, RotateCcw } from "lucide-vue-next";
import Button from "@/components/ui/button.vue";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { extractDelta, parseCurl } from "@/lib/curl";
import { readGatewayStream } from "@/lib/stream";
import { cn } from "@/lib/utils";

const props = defineProps<{
  modelValue: string;
  /** Height class for the response pane. */
  responseClass?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const running = ref(false);
const prompt = ref("");
const answer = ref("");
const reasoning = ref("");
const error = ref("");
const status = ref("");
const hasRun = ref(false);
let controller: AbortController | null = null;

const rows = computed(() =>
  Math.min(16, Math.max(6, props.modelValue.split("\n").length)),
);

function promptFromBody(body?: string): string {
  if (!body) return "";
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const list = Array.isArray(json.messages) ? json.messages : [];
    const last = [...list]
      .reverse()
      .find((m) => (m as { role?: string })?.role === "user") as
      { content?: unknown } | undefined;
    if (typeof last?.content === "string") return last.content;
    if (typeof json.input === "string") return json.input;
    return "";
  } catch {
    return "";
  }
}

async function run() {
  if (running.value) return;
  error.value = "";
  answer.value = "";
  reasoning.value = "";
  status.value = "";
  let parsed;
  try {
    parsed = parseCurl(props.modelValue);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Invalid curl command.";
    hasRun.value = true;
    return;
  }
  prompt.value = promptFromBody(parsed.body);
  hasRun.value = true;
  running.value = true;
  controller = new AbortController();
  try {
    const response = await fetch(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      body: parsed.method === "GET" ? undefined : parsed.body,
      signal: controller.signal,
    });
    status.value = `${response.status} ${response.statusText}`.trim();
    await readGatewayStream(
      response,
      () => {},
      (payload) => {
        const delta = extractDelta(payload);
        answer.value += delta.text;
        reasoning.value += delta.reasoning;
      },
    );
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError"))
      error.value = e instanceof Error ? e.message : "Request failed.";
  } finally {
    running.value = false;
    controller = null;
  }
}

function stop() {
  controller?.abort();
}

function reset() {
  stop();
  hasRun.value = false;
  answer.value = "";
  reasoning.value = "";
  error.value = "";
  status.value = "";
}

watch(
  () => props.modelValue,
  () => {
    if (!running.value && hasRun.value && error.value) error.value = "";
  },
);
onUnmounted(stop);
defineExpose({ run, reset });
</script>

<template>
  <div class="space-y-3">
    <textarea
      :value="modelValue"
      :rows="rows"
      spellcheck="false"
      autocomplete="off"
      aria-label="curl command"
      class="block w-full resize-y rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-xs leading-5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
      @input="
        emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)
      "
      @keydown.meta.enter.prevent="run"
      @keydown.ctrl.enter.prevent="run"
    />
    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="!running" size="sm" @click="run"
        ><Play class="size-2.5" />Run</Button
      >
      <Button v-else size="sm" variant="outline" @click="stop"
        ><Square class="size-2.5" />Stop</Button
      >
      <Button v-if="hasRun && !running" size="sm" variant="ghost" @click="reset"
        ><RotateCcw class="size-2.5" />Clear</Button
      >
      <span class="ml-auto text-xs text-muted-foreground">
        <template v-if="status">{{ status }} · </template>⌘/Ctrl + Enter to run
      </span>
    </div>

    <div v-if="hasRun" class="rounded-lg border bg-background">
      <Conversation :class="cn('max-h-96 min-h-32', responseClass)">
        <ConversationContent class="gap-6">
          <Message v-if="prompt" from="user">
            <MessageContent>{{ prompt }}</MessageContent>
          </Message>
          <Message v-if="!error || answer || reasoning" from="assistant">
            <MessageContent class="w-full">
              <Reasoning
                v-if="reasoning"
                :is-streaming="running && !answer"
                :default-open="false"
                class="mb-0"
              >
                <ReasoningTrigger />
                <ReasoningContent :content="reasoning" />
              </Reasoning>
              <MessageResponse v-if="answer" :content="answer" />
              <Shimmer v-else-if="running && !reasoning" :duration="1"
                >Thinking...</Shimmer
              >
              <p
                v-else-if="!running && !reasoning"
                class="text-xs text-muted-foreground"
              >
                The response has no text.
              </p>
            </MessageContent>
          </Message>
          <p
            v-if="error"
            role="alert"
            class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {{ error }}
          </p>
        </ConversationContent>
      </Conversation>
    </div>
  </div>
</template>
