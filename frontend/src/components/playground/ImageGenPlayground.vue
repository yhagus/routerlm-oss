<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import {
  Download,
  ImageIcon,
  LoaderCircle,
  Play,
  RotateCcw,
} from "lucide-vue-next";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Select from "@/components/ui/select.vue";

const props = defineProps<{
  baseUrl: string;
  apiKey: string;
  models: string[];
}>();

const selectedModel = ref("");
const prompt = ref("A hand-drawn map of a coastal town at sunrise");
const size = ref("auto");
const quality = ref("auto");
const n = ref(1);
const running = ref(false);
const error = ref("");
const hasRun = ref(false);
const imageSources = ref<string[]>([]);
const latency = ref<number | null>(null);
const progress = ref("");
let controller: AbortController | null = null;

const modelOptions = computed(() =>
  props.models.map((model) => ({ value: model, label: model })),
);

const sizeOptions = ["auto", "1024x1024", "1024x1536", "1536x1024"].map(
  (value) => ({ value, label: value }),
);

const qualityOptions = ["auto", "low", "medium", "high"].map((value) => ({
  value,
  label: value,
}));

watch(
  () => props.models,
  (models) => {
    if (!models.some((m) => m === selectedModel.value))
      selectedModel.value = models[0] || "";
  },
  { immediate: true },
);

const canRun = computed(
  () => Boolean(selectedModel.value && prompt.value.trim()) && !running.value,
);

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const item = payload as Record<string, unknown>;
    const nested =
      item.error && typeof item.error === "object"
        ? (item.error as Record<string, unknown>)
        : null;
    return String(
      nested?.message || item.message || item.error || "Image generation failed",
    );
  }
  return String(payload || "Image generation failed");
}

function imageSource(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const value = item as Record<string, unknown>;
  if (typeof value.url === "string") return value.url;
  if (typeof value.b64_json === "string")
    return `data:image/png;base64,${value.b64_json}`;
  return "";
}

async function run() {
  if (running.value) return;
  if (!selectedModel.value || !prompt.value.trim()) return;
  error.value = "";
  imageSources.value = [];
  progress.value = "";
  hasRun.value = true;
  running.value = true;
  latency.value = null;
  controller = new AbortController();
  const body = {
    model: selectedModel.value,
    prompt: prompt.value,
    n: n.value,
    size: size.value,
    quality: quality.value,
  };
  const url = `${props.baseUrl}/images/generations?stream=true`;
  const started = performance.now();
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
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(text || `Request failed (${response.status})`);
      }
      throw new Error(errorMessage(payload));
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const data = await response.json();
      const items = Array.isArray(data?.data) ? data.data : [];
      imageSources.value = items.map(imageSource).filter(Boolean);
      if (!imageSources.value.length) {
        throw new Error("The response contained no images.");
      }
      latency.value = Math.round(performance.now() - started);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body.");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const lines = block.split("\n");
        let eventName = "";
        let dataStr = "";
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (eventName === "progress" && data?.stage) {
          progress.value = String(data.stage);
        }
        if (eventName === "partial_image" && data?.b64_json) {
          imageSources.value = [`data:image/png;base64,${data.b64_json}`];
        }
        if (eventName === "done") {
          const items = Array.isArray(data?.data) ? data.data : [];
          const sources = items.map(imageSource).filter(Boolean);
          if (sources.length) imageSources.value = sources;
          progress.value = "";
        }
        if (eventName === "error") {
          throw new Error(data?.message || "Image generation failed.");
        }
      }
    }
    latency.value = Math.round(performance.now() - started);
    if (!imageSources.value.length) {
      throw new Error("The response contained no images.");
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    error.value = e instanceof Error ? e.message : "Request failed.";
  } finally {
    running.value = false;
    progress.value = "";
    controller = null;
  }
}

function stop() {
  controller?.abort();
}

function reset() {
  stop();
  hasRun.value = false;
  imageSources.value = [];
  error.value = "";
  latency.value = null;
  progress.value = "";
}

onUnmounted(stop);
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <ImageIcon class="size-4 text-primary" />
      <p class="text-sm font-semibold">Image generation playground</p>
      <span
        v-if="hasRun && !running"
        class="ml-auto text-xs font-medium"
        :class="error ? 'text-destructive' : 'text-success'"
      >
        {{ error ? "Failed" : "Image generated" }}
      </span>
    </div>
    <p class="text-xs text-muted-foreground">
      Enter a prompt and generate an image. The response shows whether the model
      supports image output.
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

    <div class="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <Input
        v-model="prompt"
        placeholder="Describe the image to generate..."
        aria-label="Prompt"
        @keydown.meta.enter.prevent="run"
        @keydown.ctrl.enter.prevent="run"
      />
      <Select
        v-model="size"
        :options="sizeOptions"
        placeholder="Size"
        class="w-32"
      />
      <Select
        v-model="quality"
        :options="qualityOptions"
        placeholder="Quality"
        class="w-28"
      />
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="!running" size="sm" :disabled="!canRun" @click="run">
        <Play class="size-2.5" />Generate
      </Button>
      <Button v-else size="sm" variant="outline" @click="stop">
        <LoaderCircle class="size-2.5 animate-spin" />Generating...
      </Button>
      <Button
        v-if="hasRun && !running"
        size="sm"
        variant="ghost"
        @click="reset"
      >
        <RotateCcw class="size-2.5" />Clear
      </Button>
      <span v-if="latency !== null" class="ml-auto text-xs text-muted-foreground">
        {{ latency }} ms
      </span>
    </div>

    <div v-if="error" class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
      {{ error }}
    </div>

    <div v-if="imageSources.length" class="grid gap-3 sm:grid-cols-2">
      <div v-for="(source, index) in imageSources" :key="index" class="relative">
        <img
          :src="source"
          :alt="`Generated image ${index + 1}`"
          class="w-full rounded-lg border border-input object-contain"
          loading="lazy"
          decoding="async"
        />
        <a
          :href="source"
          :download="`generated-${index + 1}.png`"
          class="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-background/80 text-foreground shadow-sm transition-colors hover:bg-background"
          aria-label="Download image"
        >
          <Download class="size-3.5" />
        </a>
      </div>
    </div>

    <div
      v-else-if="running"
      class="flex items-center justify-center rounded-lg border border-dashed border-input bg-muted/30 py-16"
    >
      <div class="flex flex-col items-center gap-2 text-muted-foreground">
        <LoaderCircle class="size-6 animate-spin" />
        <p class="text-xs">
          {{ progress || "Generating image..." }}
        </p>
      </div>
    </div>
  </div>
</template>
