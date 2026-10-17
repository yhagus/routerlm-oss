<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  FileJson2,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Unplug,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import { readGatewayStream } from "@/lib/stream";
import type { ModelItem } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import Card from "@/components/ui/card.vue";
import Button from "@/components/ui/button.vue";
import Badge from "@/components/ui/badge.vue";
import Select from "@/components/ui/select.vue";
import ModelSelect from "@/components/chat/ModelSelect.vue";
import { useNotificationStore } from "@/stores/notifications";

type ReplayFormat = "openai" | "messages" | "responses";
type RunState = "idle" | "streaming" | "complete" | "error";
type JsonRecord = Record<string, unknown>;
type ReplayStep = {
  id: number;
  label: string;
  file: string;
  description: string;
};

const replaySteps: ReplayStep[] = [
  {
    id: 1,
    label: "Client request",
    file: "1_req_client.json",
    description: "Raw request from the client.",
  },
  {
    id: 2,
    label: "Source body",
    file: "2_req_source.json",
    description: "The normalized source body.",
  },
  {
    id: 3,
    label: "OpenAI intermediate",
    file: "3_req_openai.json",
    description: "The source request in the OpenAI form.",
  },
  {
    id: 4,
    label: "Target request",
    file: "4_req_target.json",
    description: "The provider request with URL and headers.",
  },
  {
    id: 5,
    label: "Provider response",
    file: "5_res_provider.txt",
    description: "The raw upstream response.",
  },
  {
    id: 6,
    label: "OpenAI response",
    file: "6_res_openai.txt",
    description: "The normalized OpenAI response.",
  },
  {
    id: 7,
    label: "Client response",
    file: "7_res_client.txt",
    description: "The final client response.",
  },
];

const formats: { value: ReplayFormat; label: string; endpoint: string }[] = [
  { value: "openai", label: "OpenAI Chat", endpoint: "/v1/chat/completions" },
  { value: "messages", label: "Anthropic Messages", endpoint: "/v1/messages" },
  { value: "responses", label: "OpenAI Responses", endpoint: "/v1/responses" },
];

const models = useQuery({
  queryKey: ["gateway-models", "translator"],
  queryFn: () => api.gateway.models("chat"),
});
const notices = useNotificationStore();
const format = ref<ReplayFormat>("openai");
const selectedModel = ref("");
const requestText = ref("");
const sourceText = ref("");
const targetText = ref("");
const responseText = ref("");
const eventText = ref("");
const runState = ref<RunState>("idle");
const error = ref("");
const elapsed = ref(0);
const abortController = ref<AbortController | null>(null);
const replayContents = ref<Record<number, string>>({});
const replayExpanded = ref<Record<number, boolean>>({ 1: true });
const replayLoading = ref<Record<string, boolean>>({});
const replayMeta = ref<{
  provider: string;
  model: string;
  sourceFormat: string;
  targetFormat: string;
} | null>(null);
let timer: number | undefined;

const availableModels = computed(() => models.data.value?.data || []);
const selectedFormat = computed(
  () => formats.find((item) => item.value === format.value) || formats[0],
);
const parsedRequest = computed<JsonRecord | null>(() =>
  parseJson(requestText.value),
);
const detectedFormat = computed(() => detectFormat(parsedRequest.value));
const requestModel = computed(() =>
  String(parsedRequest.value?.model || selectedModel.value || ""),
);
const provider = computed(() =>
  requestModel.value.includes("/")
    ? requestModel.value.split("/", 1)[0]
    : "Unresolved",
);
const statusLabel = computed(
  () =>
    ({
      idle: "Ready",
      streaming: "Streaming",
      complete: "Complete",
      error: "Error",
    })[runState.value],
);
const statusVariant = computed(
  () =>
    ({
      idle: "secondary",
      streaming: "default",
      complete: "success",
      error: "destructive",
    })[runState.value] as "secondary" | "default" | "success" | "destructive",
);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJson(value: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function sampleRequest(kind: ReplayFormat, model: string): string {
  const safeModel = model || "provider/model";
  const message =
    "Trace this request through the v2 gateway and summarize the active translation boundary.";
  if (kind === "messages")
    return pretty({
      model: safeModel,
      max_tokens: 1024,
      messages: [{ role: "user", content: message }],
      stream: true,
    });
  if (kind === "responses")
    return pretty({
      model: safeModel,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: message }],
        },
      ],
      stream: true,
    });
  return pretty({
    model: safeModel,
    messages: [{ role: "user", content: message }],
    stream: true,
  });
}

function detectFormat(body: JsonRecord | null): string {
  if (!body) return "Invalid JSON";
  if ("input" in body) return "OpenAI Responses";
  if (
    "max_tokens_to_sample" in body ||
    ("system" in body && !Array.isArray(body.messages))
  )
    return "Anthropic Messages";
  return "OpenAI Chat";
}

function clearRunOutput() {
  sourceText.value = "";
  targetText.value = "";
  responseText.value = "";
  eventText.value = "";
  error.value = "";
  elapsed.value = 0;
  runState.value = "idle";
}

function resetRequest() {
  abortController.value?.abort();
  selectedModel.value = availableModels.value[0]?.id || "";
  requestText.value = sampleRequest(format.value, selectedModel.value);
  clearRunOutput();
}

function applyFormatTemplate() {
  requestText.value = sampleRequest(format.value, selectedModel.value);
  clearRunOutput();
}

function formatRequest() {
  const parsed = parseJson(requestText.value);
  if (!parsed) {
    error.value = "The client request is not valid JSON.";
    runState.value = "error";
    return;
  }
  requestText.value = pretty(parsed);
}

async function copyText(value: string, label: string) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    notices.push("success", `${label} copied to the clipboard.`);
  } catch {
    notices.push("error", `Could not copy ${label.toLowerCase()}.`);
  }
}

function startTimer() {
  const started = Date.now();
  timer = window.setInterval(() => {
    elapsed.value = Date.now() - started;
  }, 50);
}

function stopTimer() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

function responseEvent(payload: JsonRecord) {
  const next = eventText.value ? `${eventText.value}\n\n` : "";
  eventText.value += `${next}${pretty(payload)}`;
}

function replayContent(id: number): string {
  return replayContents.value[id] || "";
}

function setReplayContent(id: number, value: string): void {
  replayContents.value = { ...replayContents.value, [id]: value };
}

function setReplayLoading(key: string, value: boolean): void {
  replayLoading.value = { ...replayLoading.value, [key]: value };
}

function toggleReplayStep(id: number): void {
  replayExpanded.value = {
    ...replayExpanded.value,
    [id]: !replayExpanded.value[id],
  };
}

function openReplayStep(id: number): void {
  replayExpanded.value = { [id]: true };
}

async function detectReplayMeta(raw: string): Promise<void> {
  const body = parseJson(raw);
  if (!body) return;
  try {
    const result = await api.translator.translate(1, body);
    replayMeta.value = result.result as typeof replayMeta.value;
  } catch {
    replayMeta.value = null;
  }
}

async function loadReplayStep(step: ReplayStep): Promise<void> {
  setReplayLoading(`load-${step.id}`, true);
  try {
    const result = await api.translator.load(step.file);
    setReplayContent(step.id, result.content);
    if (step.id === 1) await detectReplayMeta(result.content);
  } catch (loadError) {
    notices.push(
      "error",
      loadError instanceof Error
        ? loadError.message
        : "Could not load the replay file.",
    );
  } finally {
    setReplayLoading(`load-${step.id}`, false);
  }
}

async function saveReplayStep(step: ReplayStep): Promise<void> {
  try {
    await api.translator.save(step.file, replayContent(step.id));
    notices.push("success", `${step.label} saved.`);
  } catch (saveError) {
    notices.push(
      "error",
      saveError instanceof Error
        ? saveError.message
        : "Could not save the replay file.",
    );
  }
}

async function translateReplayToOpenAi(): Promise<void> {
  const body = parseJson(replayContent(1));
  if (!body)
    return notices.push("error", "The client request must contain valid JSON.");
  setReplayLoading("openai", true);
  try {
    await api.translator.save("1_req_client.json", replayContent(1));
    await api.translator.save(
      "2_req_source.json",
      pretty({
        timestamp: new Date().toISOString(),
        headers: {},
        body: unwrapReplayBody(body),
      }),
    );
    const result = await api.translator.translate(2, body);
    setReplayContent(3, pretty(result.result.body));
    await detectReplayMeta(replayContent(1));
    openReplayStep(3);
  } catch (translateError) {
    notices.push(
      "error",
      translateError instanceof Error
        ? translateError.message
        : "Could not translate the source request.",
    );
  } finally {
    setReplayLoading("openai", false);
  }
}

function unwrapReplayBody(value: JsonRecord): JsonRecord {
  return isRecord(value.body) ? value.body : value;
}

async function translateReplayToTarget(): Promise<void> {
  const body = parseJson(replayContent(3));
  if (!body)
    return notices.push("error", "The OpenAI request must contain valid JSON.");
  if (!replayMeta.value)
    return notices.push(
      "error",
      "Load or edit the client request before you create the target request.",
    );
  setReplayLoading("target", true);
  try {
    await api.translator.save("3_req_openai.json", replayContent(3));
    const result = await api.translator.translate(3, {
      ...body,
      provider: replayMeta.value.provider,
      model: replayMeta.value.model,
    });
    setReplayContent(
      4,
      pretty({
        ...result.result,
        provider: replayMeta.value.provider,
        model: replayMeta.value.model,
      }),
    );
    openReplayStep(4);
  } catch (translateError) {
    notices.push(
      "error",
      translateError instanceof Error
        ? translateError.message
        : "Could not create the target request.",
    );
  } finally {
    setReplayLoading("target", false);
  }
}

async function sendReplayTarget(): Promise<void> {
  const target = parseJson(replayContent(4));
  if (!target)
    return notices.push("error", "The target request must contain valid JSON.");
  const provider = String(target.provider || replayMeta.value?.provider || "");
  const model = String(target.model || replayMeta.value?.model || "");
  const body = isRecord(target.body) ? target.body : target;
  if (!provider || !model)
    return notices.push(
      "error",
      "The target request needs a provider and model.",
    );
  setReplayLoading("send", true);
  try {
    await api.translator.save("4_req_target.json", replayContent(4));
    const response = await api.translator.send(provider, model, body);
    const raw = await response.text();
    setReplayContent(5, raw);
    await api.translator.save("5_res_provider.txt", raw);
    openReplayStep(5);
  } catch (sendError) {
    notices.push(
      "error",
      sendError instanceof Error
        ? sendError.message
        : "The provider request failed.",
    );
  } finally {
    setReplayLoading("send", false);
  }
}

async function runRequest() {
  if (runState.value === "streaming") return;
  const parsed = parseJson(requestText.value);
  if (!parsed) {
    error.value = "The client request must be valid JSON before it can run.";
    runState.value = "error";
    return;
  }

  const body: JsonRecord = { ...parsed };
  if (selectedModel.value) body.model = selectedModel.value;
  if (!body.model) {
    error.value = "Choose a model or add a model field to the client request.";
    runState.value = "error";
    return;
  }

  const controller = new AbortController();
  abortController.value?.abort();
  abortController.value = controller;
  sourceText.value = pretty(body);
  targetText.value = pretty({
    method: "POST",
    endpoint: selectedFormat.value.endpoint,
    body,
  });
  responseText.value = "";
  eventText.value = "";
  error.value = "";
  runState.value = "streaming";
  startTimer();
  let text = "";

  try {
    const headers: HeadersInit =
      format.value === "messages" ? { "anthropic-version": "2023-06-01" } : {};
    const response = await api.gateway.post(
      selectedFormat.value.endpoint,
      body,
      controller.signal,
      headers,
    );
    await readGatewayStream(
      response,
      (delta) => {
        text += delta;
        responseText.value = text;
      },
      responseEvent,
    );
    responseText.value =
      text ||
      "The gateway returned an empty text response. Inspect the normalized events for details.";
    runState.value = "complete";
  } catch (requestError) {
    if (
      requestError instanceof DOMException &&
      requestError.name === "AbortError"
    )
      return;
    if (requestError instanceof Error && requestError.name === "AbortError")
      return;
    error.value =
      requestError instanceof Error
        ? requestError.message
        : "The v2 gateway request failed.";
    runState.value = "error";
  } finally {
    stopTimer();
    if (abortController.value === controller) abortController.value = null;
  }
}

function stopRequest() {
  abortController.value?.abort();
  abortController.value = null;
  stopTimer();
  runState.value = "idle";
}

watch(
  availableModels,
  (next: ModelItem[]) => {
    if (!selectedModel.value && next[0]) {
      selectedModel.value = next[0].id;
      if (!requestText.value)
        requestText.value = sampleRequest(format.value, selectedModel.value);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  abortController.value?.abort();
  stopTimer();
});
</script>

<template>
  <div class="theme-v2 space-y-6">
    <PageHeader
      title="Translator replay"
      description="Replay a client payload through the live v2 gateway and inspect the boundary between the request and streamed response."
    >
      <template #actions>
        <Button
          variant="outline"
          :disabled="runState === 'streaming'"
          @click="resetRequest"
          ><RotateCcw class="size-4" />Reset sample</Button
        >
        <Button
          variant="outline"
          :disabled="models.isFetching.value"
          @click="models.refetch()"
          ><RefreshCw
            :class="['size-4', models.isFetching.value && 'animate-spin']"
          />Refresh models</Button
        >
      </template>
    </PageHeader>

    <div
      v-if="models.isError.value"
      class="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {{
        models.error.value?.message ||
        "The v2 model catalog could not be loaded. You can still edit the request manually."
      }}
    </div>
    <div
      v-if="error"
      class="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      {{ error }}
    </div>

    <Card class="p-4 sm:p-5">
      <div
        class="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between"
      >
        <div class="flex items-start gap-3">
          <div
            class="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"
          >
            <ArrowRightLeft class="size-5" />
          </div>
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-semibold">Live route controls</h2>
              <Badge :variant="statusVariant">{{ statusLabel }}</Badge
              ><span
                v-if="elapsed"
                class="text-xs tabular-nums text-muted-foreground"
                >{{ elapsed }} ms</span
              >
            </div>
            <p class="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              The v2 runtime owns the compatibility route and streams the
              normalized response back here. Internal provider executor files
              remain outside this frontend surface.
            </p>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:min-w-[34rem]">
          <label class="space-y-1.5"
            ><span class="text-xs font-medium text-muted-foreground"
              >Client format</span
            ><Select
              v-model="format"
              :options="formats"
              :disabled="runState === 'streaming'"
              @update:model-value="applyFormatTemplate"
          /></label>
          <label class="space-y-1.5"
            ><span class="text-xs font-medium text-muted-foreground"
              >Gateway model</span
            ><ModelSelect
              v-model="selectedModel"
              :models="availableModels"
              :disabled="runState === 'streaming'"
          /></label>
        </div>
      </div>
      <div
        class="mt-5 grid gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground sm:grid-cols-3"
      >
        <div>
          <span class="font-medium text-foreground">Source</span>
          {{ detectedFormat }}
        </div>
        <div>
          <span class="font-medium text-foreground">Provider</span>
          {{ provider }}
        </div>
        <div>
          <span class="font-medium text-foreground">Route</span>
          <code>{{ selectedFormat.endpoint }}</code>
        </div>
      </div>
    </Card>

    <section class="grid gap-6 xl:grid-cols-[minmax(0,.92fr)_minmax(0,1.08fr)]">
      <Card class="overflow-hidden">
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4"
        >
          <div class="flex items-center gap-3">
            <div
              class="grid size-8 place-items-center rounded-lg bg-accent text-primary"
            >
              <FileJson2 class="size-4" />
            </div>
            <div>
              <h2 class="text-sm font-semibold">1 · Client request</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                Editable JSON sent to the selected v2 compatibility route.
              </p>
            </div>
          </div>
          <Badge variant="secondary">local editor</Badge>
        </div>
        <div class="p-4 sm:p-5">
          <label for="translator-request" class="sr-only"
            >Client request JSON</label
          >
          <textarea
            id="translator-request"
            v-model="requestText"
            spellcheck="false"
            class="min-h-[28rem] w-full resize-y rounded-lg border border-input bg-[#171514] p-4 font-mono text-xs leading-5 text-[#f2efeb] outline-none transition-colors placeholder:text-[#aaa39d] focus:border-ring focus:ring-2 focus:ring-ring/30"
            placeholder="Paste an OpenAI, Anthropic, or Responses request..."
          />
          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              :disabled="!requestText"
              @click="formatRequest"
              ><Code2 class="size-4" />Format JSON</Button
            >
            <Button
              variant="outline"
              :disabled="!requestText"
              @click="copyText(requestText, 'Client request')"
              ><Clipboard class="size-4" />Copy</Button
            >
            <Button
              v-if="runState === 'streaming'"
              variant="destructive"
              @click="stopRequest"
              ><Square class="size-3.5" />Stop</Button
            >
            <Button v-else :disabled="!requestText" @click="runRequest"
              ><Send class="size-4" />Run through v2</Button
            >
          </div>
        </div>
      </Card>

      <div class="space-y-6">
        <Card class="overflow-hidden">
          <div
            class="flex items-center justify-between border-b border-border/70 px-5 py-4"
          >
            <div class="flex items-center gap-3">
              <div
                class="grid size-8 place-items-center rounded-lg bg-accent text-primary"
              >
                <ArrowRight class="size-4" />
              </div>
              <div>
                <h2 class="text-sm font-semibold">2 · Gateway boundary</h2>
                <p class="mt-1 text-xs text-muted-foreground">
                  The local source and target envelope used for this run.
                </p>
              </div>
            </div>
            <Badge :variant="targetText ? 'success' : 'secondary'">{{
              targetText ? "captured" : "waiting"
            }}</Badge>
          </div>
          <div class="grid gap-4 p-4 sm:p-5">
            <div>
              <div class="mb-2 flex items-center justify-between gap-2">
                <span
                  class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >Source body</span
                ><Button
                  variant="ghost"
                  size="icon"
                  :disabled="!sourceText"
                  aria-label="Copy source body"
                  @click="copyText(sourceText, 'Source body')"
                  ><Clipboard class="size-3.5"
                /></Button>
              </div>
              <pre
                class="max-h-44 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-5 text-muted-foreground"
                >{{
                  sourceText ||
                  "Run a request to capture the parsed source body."
                }}</pre>
            </div>
            <div>
              <div class="mb-2 flex items-center justify-between gap-2">
                <span
                  class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >Target request</span
                ><Button
                  variant="ghost"
                  size="icon"
                  :disabled="!targetText"
                  aria-label="Copy target request"
                  @click="copyText(targetText, 'Target request')"
                  ><Clipboard class="size-3.5"
                /></Button>
              </div>
              <pre
                class="max-h-52 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-5 text-muted-foreground"
                >{{
                  targetText ||
                  "The v2 endpoint and body will appear here before the request is sent."
                }}</pre>
            </div>
          </div>
        </Card>

        <Card class="p-5">
          <div class="flex items-start gap-3">
            <Unplug class="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-sm font-semibold">Seven-step replay</h2>
                <Badge variant="success">v1 workflow</Badge>
              </div>
              <p class="mt-1 text-sm leading-6 text-muted-foreground">
                Load saved request logs, create the source and target requests,
                then send the target request through the selected provider
                executor.
              </p>
              <div
                v-if="replayMeta"
                class="mt-3 flex flex-wrap gap-2 text-[11px]"
              >
                <Badge variant="secondary"
                  >src: {{ replayMeta.sourceFormat }}</Badge
                ><Badge variant="secondary"
                  >dst: {{ replayMeta.targetFormat }}</Badge
                ><Badge variant="secondary"
                  >{{ replayMeta.provider }}/{{ replayMeta.model }}</Badge
                >
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>

    <section class="space-y-3">
      <Card v-for="step in replaySteps" :key="step.id" class="overflow-hidden">
        <div class="flex items-center justify-between gap-3 px-5 py-4">
          <button
            class="flex min-w-0 flex-1 items-center gap-3 text-left"
            @click="toggleReplayStep(step.id)"
          >
            <ChevronRight
              class="size-4 shrink-0 transition-transform"
              :class="replayExpanded[step.id] && 'rotate-90'"
            /><span class="font-mono text-xs text-muted-foreground">{{
              step.id
            }}</span
            ><span class="min-w-0"
              ><span class="block text-sm font-semibold">{{ step.label }}</span
              ><span class="block truncate text-xs text-muted-foreground"
                >{{ step.file }} · {{ step.description }}</span
              ></span
            >
          </button>
          <div class="flex shrink-0 gap-2">
            <Button
              variant="outline"
              :disabled="replayLoading[`load-${step.id}`]"
              @click="loadReplayStep(step)"
              >{{
                replayLoading[`load-${step.id}`] ? "Loading" : "Load"
              }}</Button
            ><Button
              v-if="replayContent(step.id)"
              variant="outline"
              @click="saveReplayStep(step)"
              >Save</Button
            >
          </div>
        </div>
        <div
          v-if="replayExpanded[step.id]"
          class="border-t border-border/70 p-4 sm:p-5"
        >
          <textarea
            :value="replayContent(step.id)"
            spellcheck="false"
            class="min-h-44 w-full resize-y rounded-lg border border-input bg-[#171514] p-3 font-mono text-xs leading-5 text-[#f2efeb] outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            :placeholder="`Load or paste ${step.file}`"
            @input="
              setReplayContent(
                step.id,
                ($event.target as HTMLTextAreaElement).value,
              );
              if (step.id === 1)
                void detectReplayMeta(
                  ($event.target as HTMLTextAreaElement).value,
                );
            "
          />
          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              v-if="step.id === 1"
              :disabled="replayLoading.openai"
              @click="translateReplayToOpenAi"
              >{{ replayLoading.openai ? "Translating" : "→ OpenAI" }}</Button
            ><Button
              v-if="step.id === 3"
              :disabled="replayLoading.target"
              @click="translateReplayToTarget"
              >{{ replayLoading.target ? "Translating" : "→ Target" }}</Button
            ><Button
              v-if="step.id === 4"
              :disabled="replayLoading.send"
              @click="sendReplayTarget"
              >{{ replayLoading.send ? "Sending" : "Send" }}</Button
            ><Button
              variant="outline"
              :disabled="!replayContent(step.id)"
              @click="copyText(replayContent(step.id), step.label)"
              >Copy</Button
            >
          </div>
        </div>
      </Card>
    </section>

    <section class="grid gap-6 xl:grid-cols-2">
      <Card class="overflow-hidden">
        <div
          class="flex items-center justify-between border-b border-border/70 px-5 py-4"
        >
          <div class="flex items-center gap-3">
            <div
              class="grid size-8 place-items-center rounded-lg bg-accent text-primary"
            >
              <RefreshCw class="size-4" />
            </div>
            <div>
              <h2 class="text-sm font-semibold">
                3 · Normalized gateway stream
              </h2>
              <p class="mt-1 text-xs text-muted-foreground">
                Parsed SSE events received from the live v2 route.
              </p>
            </div>
          </div>
          <Badge :variant="eventText ? 'success' : 'secondary'">{{
            eventText ? "captured" : "waiting"
          }}</Badge>
        </div>
        <div class="p-4 sm:p-5">
          <pre
            class="min-h-56 max-h-[30rem] overflow-auto rounded-lg bg-[#171514] p-4 font-mono text-[11px] leading-5 text-[#f2efeb]"
            >{{
              eventText ||
              "No stream events yet. Run the client request to inspect the gateway response events."
            }}</pre>
          <div class="mt-3 flex justify-end">
            <Button
              variant="outline"
              :disabled="!eventText"
              @click="copyText(eventText, 'Normalized events')"
              ><Clipboard class="size-4" />Copy events</Button
            >
          </div>
        </div>
      </Card>
      <Card class="overflow-hidden">
        <div
          class="flex items-center justify-between border-b border-border/70 px-5 py-4"
        >
          <div class="flex items-center gap-3">
            <div
              class="grid size-8 place-items-center rounded-lg bg-accent text-primary"
            >
              <Check class="size-4" />
            </div>
            <div>
              <h2 class="text-sm font-semibold">4 · Client response</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                Text assembled from the response format selected above.
              </p>
            </div>
          </div>
          <Badge :variant="responseText ? 'success' : 'secondary'">{{
            responseText ? "captured" : "waiting"
          }}</Badge>
        </div>
        <div class="p-4 sm:p-5">
          <pre
            class="min-h-56 max-h-[30rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-4 font-mono text-xs leading-6"
            >{{
              responseText ||
              "The final client-facing text will appear here after the v2 request completes."
            }}</pre>
          <div class="mt-3 flex justify-end">
            <Button
              variant="outline"
              :disabled="!responseText"
              @click="copyText(responseText, 'Client response')"
              ><Clipboard class="size-4" />Copy response</Button
            >
          </div>
        </div>
      </Card>
    </section>

    <Card class="flex items-start gap-3 p-4 text-sm text-muted-foreground"
      ><ArrowRightLeft class="mt-0.5 size-4 shrink-0 text-primary" />
      <p>
        <span class="font-medium text-foreground">Migration note:</span> v2
        exposes the public compatibility boundary, not the root app's internal
        source → OpenAI → target snapshots. Use the target envelope and
        normalized events here to debug a live route; add a v2 trace API before
        exposing provider-internal stages.
      </p></Card
    >
  </div>
</template>
