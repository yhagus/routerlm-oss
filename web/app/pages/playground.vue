<script setup lang="ts">
import { ImagePlus, Send, Square, Trash2, X } from "@lucide/vue";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { apiErrorMessage } from "~/lib/api";
import { REASONING_EFFORTS, type ReasoningEffort } from "~/lib/parameterPolicy";
import {
  type AssistantMessage,
  chatCompletionRequest,
  dataUrlOf,
  MAX_IMAGE_BYTES,
  type PlaygroundError,
  type PlaygroundMessage,
  type PlaygroundSettings,
  type PlaygroundSummary,
  playgroundErrorOfFailure,
  streamEventsOf,
} from "~/lib/playground";
import type { ModelSummary } from "~/lib/routing";
import { formatCost, formatCount } from "~/lib/usage";

useHead({ title: "Playground" });

const MODEL_DEFAULT = "default";
const { $dashboardApi } = useNuxtApp();

// Settings

const { data: models, error: modelsError } = await useDashboardApi<ModelSummary[]>("/models");
const modelOptions = computed(() =>
  (models.value ?? [])
    .filter((model) => model.isEnabled)
    .map((model) => ({ value: model.name, label: model.name })),
);
const modelName = ref("");
watch(
  modelOptions,
  (options) => {
    if (!options.some((option) => option.value === modelName.value)) {
      modelName.value = options[0]?.value ?? "";
    }
  },
  { immediate: true },
);

const systemPrompt = ref("");
const temperature = ref("");
const topP = ref("");
const maxOutputTokens = ref("");
const reasoningEffort = ref(MODEL_DEFAULT);
const reasoningOptions = [
  { value: MODEL_DEFAULT, label: "Model default" },
  ...REASONING_EFFORTS.map((effort) => ({ value: effort, label: effort })),
];

function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

/** An optional number field: undefined when empty, null when it isn't a number in range. */
function numberField(text: string, isValid: (value: number) => boolean): number | undefined | null {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) && isValid(value) ? value : null;
}

/** The settings to send, or what is wrong with them. */
function readSettings(): { settings: PlaygroundSettings } | { problem: string } {
  if (modelName.value === "") return { problem: "Pick a Model." };
  const parsedTemperature = numberField(temperature.value, (value) => value >= 0 && value <= 2);
  if (parsedTemperature === null) return { problem: "Temperature must be from 0 to 2." };
  const parsedTopP = numberField(topP.value, (value) => value >= 0 && value <= 1);
  if (parsedTopP === null) return { problem: "Top P must be from 0 to 1." };
  const parsedMaxOutputTokens = numberField(
    maxOutputTokens.value,
    (value) => Number.isInteger(value) && value > 0,
  );
  if (parsedMaxOutputTokens === null) {
    return { problem: "Max output tokens must be a whole number above 0." };
  }
  return {
    settings: {
      model: modelName.value,
      systemPrompt: systemPrompt.value,
      temperature: parsedTemperature,
      topP: parsedTopP,
      maxOutputTokens: parsedMaxOutputTokens,
      reasoningEffort: isReasoningEffort(reasoningEffort.value) ? reasoningEffort.value : undefined,
    },
  };
}

// Conversation: lives in this page only, and is gone on reload.

const conversation = ref<PlaygroundMessage[]>([]);
const draft = ref("");
const draftImageUrls = ref<string[]>([]);
const composerError = ref("");
const runningRequest = ref<AbortController | null>(null);
const log = ref<HTMLElement>();
const isSending = computed(() => runningRequest.value !== null);
const canSend = computed(
  () =>
    !isSending.value &&
    modelName.value !== "" &&
    (draft.value.trim() !== "" || draftImageUrls.value.length > 0),
);

watch(
  conversation,
  async () => {
    await nextTick();
    log.value?.scrollTo({ top: log.value.scrollHeight });
  },
  { deep: true },
);

async function attachImages(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files) return;
  composerError.value = "";
  for (const file of Array.from(input.files)) {
    if (file.size > MAX_IMAGE_BYTES) {
      composerError.value = `${file.name} is over 5 MB.`;
      continue;
    }
    draftImageUrls.value.push(await dataUrlOf(file));
  }
  input.value = "";
}

function removeImage(index: number): void {
  draftImageUrls.value.splice(index, 1);
}

function sendOnEnter(event: KeyboardEvent): void {
  if (event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (canSend.value) void send();
}

async function send(): Promise<void> {
  const read = readSettings();
  if ("problem" in read) {
    composerError.value = read.problem;
    return;
  }
  composerError.value = "";
  conversation.value.push({
    role: "user",
    text: draft.value.trim(),
    imageUrls: draftImageUrls.value,
  });
  draft.value = "";
  draftImageUrls.value = [];
  const body = chatCompletionRequest(read.settings, conversation.value);
  // Reactive, so the page shows the answer as it streams in.
  const answer = reactive<AssistantMessage>({
    role: "assistant",
    text: "",
    reasoning: "",
    state: { kind: "streaming" },
  });
  conversation.value.push(answer);

  const request = new AbortController();
  runningRequest.value = request;
  try {
    const stream = await $dashboardApi("/playground/chat/completions", {
      method: "POST",
      body,
      responseType: "stream",
      signal: request.signal,
    });
    let streamError: PlaygroundError | null = null;
    let summary: PlaygroundSummary | null = null;
    for await (const event of streamEventsOf(stream)) {
      if (event.kind === "text") answer.text += event.text;
      else if (event.kind === "reasoning") answer.reasoning += event.text;
      else if (event.kind === "error") streamError = event.error;
      else summary = event.summary;
    }
    answer.state = streamError
      ? { kind: "failed", error: streamError, summary }
      : { kind: "done", summary };
  } catch (failure) {
    if (request.signal.aborted) {
      answer.state = { kind: "stopped" };
      return;
    }
    const error = (await playgroundErrorOfFailure(failure)) ?? {
      code: null,
      message: apiErrorMessage(failure, "The request did not reach the gateway."),
    };
    answer.state = { kind: "failed", error, summary: null };
  } finally {
    runningRequest.value = null;
  }
}

function stop(): void {
  runningRequest.value?.abort();
}

function clearConversation(): void {
  stop();
  conversation.value = [];
}

function summaryFacts(summary: PlaygroundSummary): { label: string; value: string }[] {
  const { usage, route, providerAccount } = summary;
  return [
    { label: "Input", value: formatCount(usage.inputTokens) },
    { label: "Output", value: formatCount(usage.outputTokens) },
    { label: "Cache read", value: formatCount(usage.cacheReadTokens) },
    { label: "Cache write", value: formatCount(usage.cacheWriteTokens) },
    { label: "Cost", value: formatCost(summary.cost) },
    { label: "Route", value: route ? `${route.providerSlug} / ${route.upstreamModelId}` : "—" },
    { label: "Provider Account", value: providerAccount?.name ?? "—" },
  ];
}
</script>

<template>
  <PageHeading
    title="Playground"
    description="Send requests to a Model through the same path client applications use. The conversation stays in this browser tab."
  >
    <button
      class="button button--quiet"
      type="button"
      :disabled="conversation.length === 0"
      @click="clearConversation"
    >
      <Trash2 :size="14" /> Clear
    </button>
  </PageHeading>

  <div class="playground">
    <section class="panel playground__chat" aria-label="Conversation">
      <div ref="log" class="playground__log" aria-live="polite">
        <div v-if="modelsError" class="empty-state">
          <strong>Couldn't load the Models.</strong
          ><span>Check that the backend is running, then reload the page.</span>
        </div>
        <div v-else-if="modelOptions.length === 0" class="empty-state">
          <strong>No enabled Model to try.</strong
          ><span>Create or enable one on the <NuxtLink to="/models">Models</NuxtLink> page.</span>
        </div>
        <div v-else-if="conversation.length === 0" class="empty-state">
          <strong>Nothing sent yet.</strong
          ><span>Pick a Model, write a message and attach images if you need them.</span>
        </div>
        <article
          v-for="(message, index) in conversation"
          :key="index"
          class="playground-message"
          :class="`playground-message--${message.role}`"
        >
          <span class="field__label">{{ message.role === "user" ? "You" : "Model" }}</span>
          <template v-if="message.role === 'user'">
            <p v-if="message.text" class="playground-message__text">{{ message.text }}</p>
            <div v-if="message.imageUrls.length > 0" class="playground-images">
              <img
                v-for="(url, imageIndex) in message.imageUrls"
                :key="imageIndex"
                :src="url"
                alt="Attached image"
              />
            </div>
          </template>
          <template v-else>
            <details v-if="message.reasoning" class="playground-message__reasoning">
              <summary>Reasoning</summary>
              <p class="playground-message__text">{{ message.reasoning }}</p>
            </details>
            <p v-if="message.text" class="playground-message__text">{{ message.text }}</p>
            <p v-else-if="message.state.kind === 'streaming'" class="cell-note">
              Waiting for the answer…
            </p>
            <p v-if="message.state.kind === 'stopped'" class="cell-note">Stopped.</p>
            <p
              v-if="message.state.kind === 'failed'"
              class="playground-message__error"
              role="alert"
            >
              <span class="status-badge status-badge--bad">{{
                message.state.error.code ?? "Error"
              }}</span>
              {{ message.state.error.message }}
            </p>
            <dl
              v-if="
                (message.state.kind === 'done' || message.state.kind === 'failed') &&
                message.state.summary
              "
              class="playground-summary"
            >
              <div v-for="fact in summaryFacts(message.state.summary)" :key="fact.label">
                <dt>{{ fact.label }}</dt>
                <dd class="tabular">{{ fact.value }}</dd>
              </div>
            </dl>
          </template>
        </article>
      </div>

      <form class="playground-composer" @submit.prevent="send">
        <div v-if="draftImageUrls.length > 0" class="playground-images">
          <div v-for="(url, index) in draftImageUrls" :key="index" class="playground-images__item">
            <img :src="url" alt="Image to send" />
            <button
              class="icon-button"
              type="button"
              aria-label="Remove image"
              @click="removeImage(index)"
            >
              <X :size="12" />
            </button>
          </div>
        </div>
        <textarea
          v-model="draft"
          class="text-input text-area"
          rows="3"
          aria-label="Message"
          placeholder="Message the Model. Enter sends, Shift+Enter adds a line."
          @keydown.enter="sendOnEnter"
        />
        <p v-if="composerError" class="form__error" role="alert">{{ composerError }}</p>
        <div class="playground-composer__actions">
          <label class="button button--quiet">
            <ImagePlus :size="14" /> Attach images
            <input class="sr-only" type="file" accept="image/*" multiple @change="attachImages" />
          </label>
          <button v-if="isSending" class="button" type="button" @click="stop">
            <Square :size="14" /> Stop
          </button>
          <button v-else class="button button--primary" type="submit" :disabled="!canSend">
            <Send :size="14" /> Send
          </button>
        </div>
      </form>
    </section>

    <section class="panel playground__settings" aria-label="Settings">
      <header class="panel-heading">
        <div>
          <h2>Settings</h2>
          <p>Empty parameters leave the choice to the Model's Parameter Policy.</p>
        </div>
      </header>
      <div class="panel-body form">
        <div class="field">
          <span class="field__label">Model</span>
          <AppSelect
            v-model="modelName"
            :options="modelOptions"
            label="Model"
            placeholder="No enabled Model"
          />
        </div>
        <label class="field">
          <span class="field__label">System prompt</span>
          <textarea v-model="systemPrompt" class="text-input text-area" rows="4" />
        </label>
        <div class="form__grid">
          <label class="field">
            <span class="field__label">Temperature</span>
            <input
              v-model="temperature"
              class="text-input"
              inputmode="decimal"
              placeholder="0 to 2"
            />
          </label>
          <label class="field">
            <span class="field__label">Top P</span>
            <input v-model="topP" class="text-input" inputmode="decimal" placeholder="0 to 1" />
          </label>
          <label class="field">
            <span class="field__label">Max output tokens</span>
            <input
              v-model="maxOutputTokens"
              class="text-input"
              inputmode="numeric"
              placeholder="Whole number"
            />
          </label>
          <div class="field">
            <span class="field__label">Reasoning effort</span>
            <AppSelect
              v-model="reasoningEffort"
              :options="reasoningOptions"
              label="Reasoning effort"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
