<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { Eye, ImageIcon, Play, Square, RotateCcw, X } from "lucide-vue-next";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Select from "@/components/ui/select.vue";
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
import { readGatewayStream } from "@/lib/stream";
import { extractDelta } from "@/lib/curl";
import { cn } from "@/lib/utils";

const props = defineProps<{
  baseUrl: string;
  apiKey: string;
  models: string[];
}>();

const selectedModel = ref("");
const prompt = ref("What is in this image?");
const imageDataUrl = ref("");
const imageName = ref("");
const answer = ref("");
const reasoning = ref("");
const error = ref("");
const status = ref("");
const running = ref(false);
const hasRun = ref(false);
const visionSupported = ref<boolean | null>(null);
let controller: AbortController | null = null;

const modelOptions = computed(() =>
  props.models.map((model) => ({ value: model, label: model })),
);

watch(
  () => props.models,
  (models) => {
    if (!models.some((m) => m === selectedModel.value))
      selectedModel.value = models[0] || "";
  },
  { immediate: true },
);

const canRun = computed(
  () => Boolean(selectedModel.value && imageDataUrl.value) && !running.value,
);

const statusLabel = computed(() => {
  if (visionSupported.value === true) return "Vision supported";
  if (visionSupported.value === false) return "Vision not supported";
  return "Untested";
});

const statusColor = computed(() => {
  if (visionSupported.value === true) return "text-success";
  if (visionSupported.value === false) return "text-destructive";
  return "text-muted-foreground";
});

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    error.value = "Please select an image file.";
    return;
  }
  imageName.value = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    imageDataUrl.value = String(reader.result || "");
  };
  reader.onerror = () => {
    error.value = "Could not read the image file.";
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  imageDataUrl.value = "";
  imageName.value = "";
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    error.value = "Please drop an image file.";
    return;
  }
  imageName.value = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    imageDataUrl.value = String(reader.result || "");
  };
  reader.onerror = () => {
    error.value = "Could not read the image file.";
  };
  reader.readAsDataURL(file);
}

async function run() {
  if (running.value) return;
  if (!selectedModel.value || !imageDataUrl.value) return;
  error.value = "";
  answer.value = "";
  reasoning.value = "";
  status.value = "";
  visionSupported.value = null;
  hasRun.value = true;
  running.value = true;
  controller = new AbortController();
  const body = {
    model: selectedModel.value,
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt.value || "What is in this image?" },
          { type: "image_url", image_url: { url: imageDataUrl.value } },
        ],
      },
    ],
  };
  const url = `${props.baseUrl}/chat/completions`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${props.apiKey || "YOUR_API_KEY"}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status.value = `${response.status} ${response.statusText}`.trim();
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message =
          parsed?.error?.message || parsed?.error || parsed?.message || text;
      } catch {
        // keep raw text
      }
      throw new Error(message || `Request failed (${response.status})`);
    }
    await readGatewayStream(
      response,
      () => {},
      (payload) => {
        const delta = extractDelta(payload);
        if (delta.text) {
          answer.value += delta.text;
          visionSupported.value = true;
        }
        if (delta.reasoning) reasoning.value += delta.reasoning;
      },
    );
    if (!answer.value.trim() && !reasoning.value.trim()) {
      visionSupported.value = false;
    } else if (visionSupported.value === null) {
      visionSupported.value = Boolean(answer.value.trim());
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    error.value = e instanceof Error ? e.message : "Request failed.";
    visionSupported.value = false;
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
  visionSupported.value = null;
}

onUnmounted(stop);
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <Eye class="size-4 text-primary" />
      <p class="text-sm font-semibold">Vision playground</p>
      <span
        v-if="hasRun"
        :class="['ml-auto text-xs font-medium', statusColor]"
      >
        {{ statusLabel }}
      </span>
    </div>
    <p class="text-xs text-muted-foreground">
      Upload an image and send it to a model. The response shows whether the
      model supports vision input.
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <label class="text-xs font-medium text-muted-foreground">Model</label>
      <Select
        v-model="selectedModel"
        :options="modelOptions"
        placeholder="Select a model"
        class="max-w-xs"
      />
    </div>

    <div
      v-if="!imageDataUrl"
      class="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-8 text-center"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <ImageIcon class="size-6 text-muted-foreground" />
      <p class="text-xs text-muted-foreground">
        Drag and drop an image here, or click to browse.
      </p>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onFileChange"
      />
      <Button
        variant="outline"
        size="sm"
        @click="($refs.fileInput as HTMLInputElement)?.click()"
      >
        <ImageIcon class="size-3" />Choose image
      </Button>
    </div>
    <div v-else class="relative inline-block">
      <img
        :src="imageDataUrl"
        :alt="imageName"
        class="max-h-48 rounded-lg border border-input object-contain"
      />
      <button
        type="button"
        class="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90"
        aria-label="Remove image"
        @click="removeImage"
      >
        <X class="size-3" />
      </button>
      <p class="mt-1 truncate text-[10px] text-muted-foreground">
        {{ imageName }}
      </p>
    </div>

    <Input
      v-model="prompt"
      placeholder="Ask about the image..."
      aria-label="Prompt"
    />

    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="!running" size="sm" :disabled="!canRun" @click="run">
        <Play class="size-2.5" />Test vision
      </Button>
      <Button v-else size="sm" variant="outline" @click="stop">
        <Square class="size-2.5" />Stop
      </Button>
      <Button
        v-if="hasRun && !running"
        size="sm"
        variant="ghost"
        @click="reset"
      >
        <RotateCcw class="size-2.5" />Clear
      </Button>
      <span class="ml-auto text-xs text-muted-foreground">
        <template v-if="status">{{ status }} · </template>Tests image input
        support
      </span>
    </div>

    <div v-if="hasRun" class="rounded-lg border bg-background">
      <Conversation :class="cn('max-h-96 min-h-32')">
        <ConversationContent class="gap-6">
          <Message from="user">
            <MessageContent>
              <p v-if="prompt">{{ prompt }}</p>
              <img
                v-if="imageDataUrl"
                :src="imageDataUrl"
                :alt="imageName"
                class="mt-2 max-h-40 rounded-md border border-input"
              />
            </MessageContent>
          </Message>
          <Message
            v-if="!error || answer || reasoning"
            from="assistant"
          >
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
              <Shimmer
                v-else-if="running && !reasoning"
                :duration="1"
              >
                Analyzing image...
              </Shimmer>
              <p
                v-else-if="!running && !reasoning"
                class="text-xs text-muted-foreground"
              >
                The model returned no text. It may not support vision input.
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
