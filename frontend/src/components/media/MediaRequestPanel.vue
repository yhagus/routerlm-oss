<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { Check, Copy, Download, LoaderCircle, Play } from "lucide-vue-next";
import type { ModelItem } from "@/types/api";
import { api } from "@/lib/api";
import { mediaKindConfig } from "@/lib/media";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import Combobox from "@/components/ui/combobox.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import Select from "@/components/ui/select.vue";

const props = defineProps<{
  kind: string;
  providerId: string;
  models: ModelItem[];
}>();
const config = computed(() => mediaKindConfig(props.kind));
const modelOptions = computed(() =>
  props.models.map((model) => ({ value: model.id, label: model.id })),
);
const imageSizeOptions = ["auto", "1024x1024", "1024x1536", "1536x1024"].map(
  (value) => ({ value, label: value }),
);
const imageQualityOptions = ["auto", "low", "medium", "high"].map((value) => ({
  value,
  label: value,
}));
const imageFormatOptions = [
  { value: "url", label: "URL" },
  { value: "b64_json", label: "Base64 JSON" },
];
const imageBackgroundOptions = [
  { value: "auto", label: "Auto" },
  { value: "transparent", label: "Transparent" },
  { value: "opaque", label: "Opaque" },
];
const imageStyleOptions = [
  { value: "", label: "Default" },
  { value: "vivid", label: "Vivid" },
  { value: "natural", label: "Natural" },
];
const imageDetailOptions = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "original", label: "Original" },
];
const imageOutputOptions = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];
const speechFormatOptions = [
  { value: "json", label: "JSON with base64 audio" },
  { value: "mp3", label: "MP3 binary" },
];
const searchTypeOptions = [
  { value: "web", label: "Web" },
  { value: "news", label: "News" },
];
const fetchFormatOptions = [
  { value: "markdown", label: "Markdown" },
  { value: "text", label: "Text" },
  { value: "html", label: "HTML" },
];
const sttFormatOptions = ["json", "text", "srt", "verbose_json", "vtt"].map(
  (value) => ({ value, label: value }),
);
const selectedModel = ref("");
const manualModel = ref("");
const prompt = ref("");
const referenceImage = ref("");
const maskImage = ref("");
const text = ref("");
const query = ref("");
const url = ref("");
const n = ref(1);
const size = ref("auto");
const quality = ref("auto");
const imageFormat = ref("url");
const background = ref("auto");
const style = ref("");
const imageDetail = ref("high");
const outputFormat = ref("png");
const embeddingInput = ref("");
const dimensions = ref("");
const speechFormat = ref("json");
const voice = ref("");
const speechLanguage = ref("");
const temperature = ref("");
const transcriptionPrompt = ref("");
const searchType = ref("web");
const maxResults = ref(5);
const country = ref("");
const language = ref("");
const fetchFormat = ref("markdown");
const maxCharacters = ref(0);
const audioFile = ref<File | null>(null);
const imagePrompt = ref("Describe this image in detail");
const running = ref(false);
const error = ref("");
const result = ref<unknown>(null);
const binaryUrl = ref("");
const copied = ref(false);
const latency = ref<number | null>(null);

watch(
  () => props.models,
  (models) => {
    if (!models.some((model) => model.id === selectedModel.value))
      selectedModel.value = models[0]?.id || "";
  },
  { immediate: true },
);

watch(
  () => props.providerId,
  () => {
    if (!props.models.length) manualModel.value = props.providerId;
  },
);

const activeModel = computed(
  () => selectedModel.value || manualModel.value || props.providerId,
);
const inputValue = computed(() =>
  props.kind === "image" || props.kind === "video"
    ? prompt.value
    : props.kind === "embedding"
      ? embeddingInput.value
      : props.kind === "webSearch"
        ? query.value
        : props.kind === "webFetch"
          ? url.value
          : props.kind === "stt"
            ? audioFile.value?.name || ""
            : text.value,
);
const requestPath = computed(() => config.value?.endpoint || "");

function nonEmptyFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) => value !== "" && value !== undefined && value !== null,
    ),
  );
}

const requestBody = computed<Record<string, unknown>>(() => {
  if (props.kind === "image")
    return nonEmptyFields({
      model: activeModel.value,
      prompt: prompt.value,
      n: n.value,
      size: size.value,
      quality: quality.value,
      background: background.value,
      style: style.value,
      response_format: imageFormat.value,
      output_format: outputFormat.value,
      image_detail: imageDetail.value,
      image: referenceImage.value,
      mask_image: maskImage.value,
    });
  if (props.kind === "video")
    return nonEmptyFields({ model: activeModel.value, prompt: prompt.value });
  if (props.kind === "embedding")
    return nonEmptyFields({
      model: activeModel.value,
      input: embeddingInput.value,
      dimensions: dimensions.value ? Number(dimensions.value) : undefined,
    });
  if (props.kind === "tts")
    return nonEmptyFields({
      model: activeModel.value,
      input: text.value,
      response_format: speechFormat.value,
      voice: voice.value,
      language: speechLanguage.value,
    });
  if (props.kind === "webSearch")
    return nonEmptyFields({
      model: activeModel.value,
      query: query.value,
      search_type: searchType.value,
      max_results: maxResults.value,
      country: country.value,
      language: language.value,
    });
  return nonEmptyFields({
    model: activeModel.value,
    url: url.value,
    format: fetchFormat.value,
    max_characters: maxCharacters.value || undefined,
  });
});

const requestPreview = computed(
  () =>
    `POST ${requestPath.value}\n\n${JSON.stringify(requestBody.value, null, 2)}`,
);

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const item = payload as Record<string, unknown>;
    const nested =
      item.error && typeof item.error === "object"
        ? (item.error as Record<string, unknown>)
        : null;
    return String(
      nested?.message || item.message || item.error || "Gateway request failed",
    );
  }
  return String(payload || "Gateway request failed");
}

function maskLargeValues(value: unknown): unknown {
  if (Array.isArray(value))
    return value.length > 80
      ? `[${value.length} values]`
      : value.map(maskLargeValues);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      key === "b64_json" && typeof item === "string" && item.length > 120
        ? `<${item.length} base64 characters>`
        : maskLargeValues(item),
    ]),
  );
}

const resultText = computed(() =>
  result.value == null
    ? "No response yet."
    : JSON.stringify(maskLargeValues(result.value), null, 2),
);

function imageSource(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const value = item as Record<string, unknown>;
  if (typeof value.url === "string") return value.url;
  if (typeof value.b64_json === "string")
    return `data:image/png;base64,${value.b64_json}`;
  return "";
}

const imageSources = computed(() => {
  if (!result.value || typeof result.value !== "object") return [];
  const data = (result.value as Record<string, unknown>).data;
  return Array.isArray(data) ? data.map(imageSource).filter(Boolean) : [];
});

async function copyRequest() {
  await navigator.clipboard?.writeText(requestPreview.value);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1600);
}

function clearBinaryUrl() {
  if (binaryUrl.value) URL.revokeObjectURL(binaryUrl.value);
  binaryUrl.value = "";
}

async function runRequest() {
  if (!requestPath.value || !inputValue.value.trim() || running.value) return;
  running.value = true;
  error.value = "";
  result.value = null;
  clearBinaryUrl();
  const started = performance.now();
  try {
    const requestPayload =
      props.kind === "stt"
        ? (() => {
            const form = new FormData();
            if (audioFile.value) form.append("file", audioFile.value);
            form.append("model", activeModel.value);
            if (language.value) form.append("language", language.value);
            if (transcriptionPrompt.value)
              form.append("prompt", transcriptionPrompt.value);
            if (temperature.value)
              form.append("temperature", temperature.value);
            form.append("response_format", speechFormat.value);
            return form;
          })()
        : requestBody.value;
    const response = await api.gateway.post(requestPath.value, requestPayload);
    latency.value = Math.round(performance.now() - started);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error(body || `Gateway request failed (${response.status})`);
      }
      throw new Error(errorMessage(payload));
    }

    if (contentType.startsWith("audio/") || contentType.startsWith("image/")) {
      binaryUrl.value = URL.createObjectURL(await response.blob());
      result.value = { binary: true, contentType };
      return;
    }

    const responseBody = await response.text();
    const data = responseBody ? JSON.parse(responseBody) : {};
    result.value = data;
    if (props.kind === "tts" && data && typeof data.audio === "string") {
      const source = data.audio.startsWith("data:")
        ? data.audio
        : `data:audio/mpeg;base64,${data.audio}`;
      binaryUrl.value = URL.createObjectURL(await (await fetch(source)).blob());
    }
  } catch (requestError) {
    error.value =
      requestError instanceof Error
        ? requestError.message
        : "Network request failed";
  } finally {
    running.value = false;
  }
}

onUnmounted(clearBinaryUrl);
</script>

<template>
  <Card class="p-5 sm:p-6">
    <div
      class="flex flex-col gap-1 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div>
        <h2 class="text-base font-semibold">Try this route</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          The request is sent to the v2 gateway with the selected model.
        </p>
      </div>
      <code
        class="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
        >{{ requestPath }}</code
      >
    </div>

    <form class="mt-5 space-y-4" @submit.prevent="runRequest">
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-2 sm:col-span-2">
          <Label for="media-model">Model</Label
          ><Combobox
            v-if="models.length"
            id="media-model"
            v-model="selectedModel"
            :options="modelOptions"
            placeholder="Search models..."
            empty-text="No models available"
          /><Input
            v-else
            id="media-model"
            v-model="manualModel"
            :placeholder="providerId"
          />
        </div>

        <div v-if="kind === 'image'" class="space-y-2 sm:col-span-2">
          <Label for="image-prompt">Prompt</Label
          ><textarea
            id="image-prompt"
            v-model="prompt"
            rows="3"
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="A hand-drawn map of a coastal town at sunrise"
          />
        </div>
        <div v-else-if="kind === 'embedding'" class="space-y-2 sm:col-span-2">
          <Label for="embedding-input">Text to embed</Label
          ><textarea
            id="embedding-input"
            v-model="embeddingInput"
            rows="3"
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="The text that should become a vector"
          />
        </div>
        <div v-else-if="kind === 'stt'" class="space-y-2 sm:col-span-2">
          <Label for="audio-file">Audio file</Label
          ><Input
            id="audio-file"
            type="file"
            accept="audio/*,video/mp4,.m4a,.mp3,.wav,.ogg,.flac,.webm,.opus"
            @change="
              audioFile = ($event.target as HTMLInputElement).files?.[0] || null
            "
          />
        </div>
        <div v-else-if="kind === 'webSearch'" class="space-y-2 sm:col-span-2">
          <Label for="search-query">Query</Label
          ><Input
            id="search-query"
            v-model="query"
            placeholder="Latest developments in local AI gateways"
          />
        </div>
        <div v-else-if="kind === 'webFetch'" class="space-y-2 sm:col-span-2">
          <Label for="fetch-url">URL</Label
          ><Input
            id="fetch-url"
            v-model="url"
            type="url"
            placeholder="https://example.com/article"
          />
        </div>
        <div v-else class="space-y-2 sm:col-span-2">
          <Label for="speech-text">Text</Label
          ><textarea
            id="speech-text"
            v-model="text"
            rows="3"
            class="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            placeholder="Hello from the LobakAI gateway"
          />
        </div>

        <template v-if="kind === 'image'">
          <div class="space-y-2">
            <Label for="image-count">Images</Label
            ><Input
              id="image-count"
              v-model.number="n"
              type="number"
              min="1"
              max="4"
            />
          </div>
          <div class="space-y-2">
            <Label for="image-size">Size</Label
            ><Select
              id="image-size"
              v-model="size"
              :options="imageSizeOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="image-quality">Quality</Label
            ><Select
              id="image-quality"
              v-model="quality"
              :options="imageQualityOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="image-format">Response</Label
            ><Select
              id="image-format"
              v-model="imageFormat"
              :options="imageFormatOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="image-background">Background</Label
            ><Select
              id="image-background"
              v-model="background"
              :options="imageBackgroundOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="image-style">Style</Label
            ><Select
              id="image-style"
              v-model="style"
              :options="imageStyleOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="image-detail">Image detail</Label
            ><Select
              id="image-detail"
              v-model="imageDetail"
              :options="imageDetailOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="image-output">Codec</Label
            ><Select
              id="image-output"
              v-model="outputFormat"
              :options="imageOutputOptions"
            />
          </div>
          <div class="space-y-2 sm:col-span-2">
            <Label for="reference-image">Reference image URL</Label
            ><Input
              id="reference-image"
              v-model="referenceImage"
              placeholder="Optional image URL"
            />
          </div>
          <div class="space-y-2 sm:col-span-2">
            <Label for="mask-image">Mask image URL</Label
            ><Input
              id="mask-image"
              v-model="maskImage"
              placeholder="Optional mask URL"
            />
          </div>
        </template>
        <template v-else-if="kind === 'tts'">
          <div class="space-y-2">
            <Label for="speech-format">Response</Label
            ><Select
              id="speech-format"
              v-model="speechFormat"
              :options="speechFormatOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="speech-voice">Voice</Label
            ><Input
              id="speech-voice"
              v-model="voice"
              placeholder="Provider default or voice id"
            />
          </div>
          <div class="space-y-2">
            <Label for="speech-language">Language</Label
            ><Input
              id="speech-language"
              v-model="speechLanguage"
              placeholder="Optional language"
            />
          </div>
        </template>
        <template v-else-if="kind === 'embedding'"
          ><div class="space-y-2">
            <Label for="embedding-dimensions">Dimensions</Label
            ><Input
              id="embedding-dimensions"
              v-model="dimensions"
              type="number"
              min="1"
              placeholder="Optional, e.g. 512"
            /></div
        ></template>
        <template v-else-if="kind === 'webSearch'">
          <div class="space-y-2">
            <Label for="search-type">Search type</Label
            ><Select
              id="search-type"
              v-model="searchType"
              :options="searchTypeOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="search-results">Max results</Label
            ><Input
              id="search-results"
              v-model.number="maxResults"
              type="number"
              min="1"
              max="100"
            />
          </div>
          <div class="space-y-2">
            <Label for="search-country">Country</Label
            ><Input
              id="search-country"
              v-model="country"
              placeholder="Optional"
            />
          </div>
          <div class="space-y-2">
            <Label for="search-language">Language</Label
            ><Input
              id="search-language"
              v-model="language"
              placeholder="Optional"
            />
          </div>
        </template>
        <template v-else-if="kind === 'webFetch'">
          <div class="space-y-2">
            <Label for="fetch-format">Format</Label
            ><Select
              id="fetch-format"
              v-model="fetchFormat"
              :options="fetchFormatOptions"
            />
          </div>
          <div class="space-y-2">
            <Label for="fetch-max">Max characters</Label
            ><Input
              id="fetch-max"
              v-model.number="maxCharacters"
              type="number"
              min="0"
              placeholder="Provider default"
            />
          </div>
        </template>
        <template v-else-if="kind === 'stt'"
          ><div class="space-y-2">
            <Label for="stt-language">Language</Label
            ><Input
              id="stt-language"
              v-model="language"
              placeholder="Optional, e.g. en"
            />
          </div>
          <div class="space-y-2">
            <Label for="stt-prompt">Prompt</Label
            ><Input
              id="stt-prompt"
              v-model="transcriptionPrompt"
              placeholder="Optional context"
            />
          </div>
          <div class="space-y-2">
            <Label for="stt-temperature">Temperature</Label
            ><Input
              id="stt-temperature"
              v-model="temperature"
              type="number"
              min="0"
              max="1"
              step="0.1"
              placeholder="0"
            />
          </div>
          <div class="space-y-2">
            <Label for="stt-format">Response</Label
            ><Select
              id="stt-format"
              v-model="speechFormat"
              :options="sttFormatOptions"
            /></div
        ></template>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          :disabled="running || !inputValue.trim() || !activeModel"
          ><LoaderCircle v-if="running" class="size-4 animate-spin" /><Play
            v-else
            class="size-4"
          />{{ running ? "Running..." : "Run request" }}</Button
        ><Button
          type="button"
          variant="outline"
          :disabled="running"
          @click="copyRequest"
          ><Check v-if="copied" class="size-4" /><Copy
            v-else
            class="size-4"
          />{{ copied ? "Copied" : "Copy request" }}</Button
        >
      </div>
    </form>

    <div
      v-if="error"
      class="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      role="alert"
    >
      {{ error }}
    </div>
    <div class="mt-5 border-t border-border/70 pt-5">
      <div class="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">Response</h3>
          <p
            v-if="latency !== null"
            class="mt-0.5 text-[11px] text-muted-foreground"
          >
            {{ latency }} ms
          </p>
        </div>
        <a
          v-if="binaryUrl"
          :href="binaryUrl"
          download="gateway-output"
          class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          ><Download class="size-3.5" />Download</a
        >
      </div>
      <audio
        v-if="kind === 'tts' && binaryUrl"
        :src="binaryUrl"
        controls
        class="mb-3 w-full"
      />
      <div v-if="imageSources.length" class="mb-3 grid gap-3 sm:grid-cols-2">
        <img
          v-for="source in imageSources"
          :key="source"
          :src="source"
          alt="Generated output"
          class="max-h-80 w-full rounded-lg border border-border object-contain"
          loading="lazy"
          decoding="async"
        />
      </div>
      <pre
        class="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5 text-foreground"
        >{{ resultText }}</pre>
    </div>
  </Card>
</template>
