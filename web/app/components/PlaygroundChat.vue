<script setup lang="ts">
import { isPublishedAs } from '~/lib/modelGroups';
import { Code, ImagePlus, SlidersHorizontal, Square, Trash2, X } from '@lucide/vue';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { computed, reactive, ref, watch } from 'vue';
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextTrigger,
} from '@/components/ai-elements/context';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputProvider,
} from '@/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { code } from '@stream-markdown/code';
import { math } from '@stream-markdown/math';
import { mermaid } from '@stream-markdown/mermaid';
import { MarkdownProvider } from 'vue-stream-markdown';
import { apiErrorMessage } from '~/lib/api';
import { REASONING_EFFORTS, type ReasoningEffort } from '~/lib/parameterPolicy';
import {
  type AssistantMessage,
  chatCompletionRequest,
  MAX_IMAGE_BYTES,
  type PlaygroundError,
  type PlaygroundMessage,
  type PlaygroundSettings,
  type PlaygroundSummary,
  playgroundErrorOfFailure,
  streamEventsOf,
} from '~/lib/playground';
import type { RouteSummary } from '~/lib/routing';
import { formatCost, formatCount } from '~/lib/usage';

const isDark = useIsDark();
const markdownExtensions = {
  code: code(),
  math: math(),
  mermaid: mermaid({ config: { securityLevel: 'strict' } }),
};

const MODEL_DEFAULT = 'default';
const { $dashboardApi } = useNuxtApp();

const {
  source,
  modelName,
  selectedUpstreamModel,
  blockedProviderIds,
  providerNamesBySlug,
  providerLogosBySlug,
  modelDetail,
  canTry,
  isLoadingSource,
  requestModel,
  requestPath,
} = usePlaygroundTarget('chat');

const systemPrompt = ref('');
const temperature = ref('');
const topP = ref('');
const maxOutputTokens = ref('');
const reasoningEffort = ref(MODEL_DEFAULT);
const reasoningOptions = [
  { value: MODEL_DEFAULT, label: 'Model default' },
  ...REASONING_EFFORTS.map((effort) => ({ value: effort, label: effort })),
];
const isSettingsSheetOpen = ref(false);

function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORTS.some((effort) => effort === value);
}

function numberField(text: string, isValid: (value: number) => boolean): number | undefined | null {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && isValid(value) ? value : null;
}

function readSettings(): { settings: PlaygroundSettings } | { problem: string } {
  const target = requestModel();
  if ('problem' in target) return target;
  const parsedTemperature = numberField(temperature.value, (value) => value >= 0 && value <= 2);
  if (parsedTemperature === null) return { problem: 'Temperature must be from 0 to 2.' };
  const parsedTopP = numberField(topP.value, (value) => value >= 0 && value <= 1);
  if (parsedTopP === null) return { problem: 'Top P must be from 0 to 1.' };
  const parsedMaxOutputTokens = numberField(
    maxOutputTokens.value,
    (value) => Number.isInteger(value) && value > 0,
  );
  if (parsedMaxOutputTokens === null) {
    return { problem: 'Max output tokens must be a whole number above 0.' };
  }
  return {
    settings: {
      model: target.model,
      systemPrompt: systemPrompt.value,
      temperature: parsedTemperature,
      topP: parsedTopP,
      maxOutputTokens: parsedMaxOutputTokens,
      reasoningEffort: isReasoningEffort(reasoningEffort.value) ? reasoningEffort.value : undefined,
    },
  };
}

const sentParameters = computed(() => {
  const parameters: string[] = [];
  if (systemPrompt.value.trim() !== '') parameters.push('System prompt');
  if (temperature.value.trim() !== '') parameters.push(`Temperature ${temperature.value}`);
  if (topP.value.trim() !== '') parameters.push(`Top P ${topP.value}`);
  if (maxOutputTokens.value.trim() !== '') {
    const tokens = Number(maxOutputTokens.value);
    parameters.push(
      `Max ${Number.isFinite(tokens) ? formatCount(tokens) : maxOutputTokens.value} tokens`,
    );
  }
  if (isReasoningEffort(reasoningEffort.value)) parameters.push(`Effort ${reasoningEffort.value}`);
  return parameters;
});

const canSeeImages = computed(() =>
  source.value === 'upstream'
    ? Boolean(selectedUpstreamModel.value?.capabilities.includes('vision'))
    : (modelDetail.value?.routes ?? []).some(
        (route) =>
          route.isEnabled &&
          route.provider.isEnabled &&
          !blockedProviderIds.value.has(route.provider.id) &&
          route.upstreamModel.isEnabled &&
          route.enabledProviderAccountCount > 0 &&
          route.upstreamModel.capabilities.includes('vision'),
      ),
);

const routesByAnswer = new WeakMap<AssistantMessage, RouteSummary[]>();
const directAnswers = new WeakSet<AssistantMessage>();
function routesOf(message: AssistantMessage): RouteSummary[] | null {
  return routesByAnswer.get(message) ?? null;
}
function isDirect(message: AssistantMessage): boolean {
  return directAnswers.has(message);
}

const conversation = ref<PlaygroundMessage[]>([]);
const composerError = ref('');
const runningRequest = ref<AbortController | null>(null);
const isSending = computed(() => runningRequest.value !== null);

const INPUT_ERRORS: Record<string, string> = {
  accept: 'Only images can be attached.',
  max_file_size: 'Images must be 5 MB or smaller.',
};

const promptInput = usePromptInputProvider({
  accept: 'image/*',
  maxFileSize: MAX_IMAGE_BYTES,
  onSubmit: submit,
  onError: (error) => (composerError.value = INPUT_ERRORS[error.code] ?? error.message),
});
const hasDraft = computed(
  () => promptInput.textInput.value.trim() !== '' || promptInput.files.value.length > 0,
);
const canSend = computed(() => !isSending.value && canTry.value && hasDraft.value);
const isActivated = useIsActivated();

async function submit(message: PromptInputMessage): Promise<void> {
  if (isSending.value) return;
  const read = readSettings();
  if ('problem' in read) throw new Error(read.problem);
  const text = message.text.trim();
  const imageUrls = message.files.map((file) => file.url);
  if (text === '' && imageUrls.length === 0) return;
  composerError.value = '';
  void send(read.settings, requestPath('chat/completions'), text, imageUrls);
}

function start(prompt: string, withImage: boolean): void {
  promptInput.setTextInput(prompt);
  if (withImage) promptInput.openFileDialog();
  else void promptInput.submitForm();
}

async function send(
  settings: PlaygroundSettings,
  path: string,
  text: string,
  imageUrls: string[],
): Promise<void> {
  conversation.value.push({ role: 'user', text, imageUrls });
  const body = chatCompletionRequest(settings, conversation.value);
  const answer = reactive<AssistantMessage>({
    role: 'assistant',
    text: '',
    reasoning: '',
    state: { kind: 'streaming' },
  });
  if (source.value === 'upstream') {
    directAnswers.add(answer);
  } else if (modelDetail.value && isPublishedAs(modelDetail.value, settings.model)) {
    routesByAnswer.set(answer, modelDetail.value.routes);
  }
  conversation.value.push(answer);

  const request = new AbortController();
  runningRequest.value = request;
  try {
    const stream = await $dashboardApi(path, {
      method: 'POST',
      body,
      responseType: 'stream',
      signal: request.signal,
    });
    let streamError: PlaygroundError | null = null;
    let summary: PlaygroundSummary | null = null;
    for await (const event of streamEventsOf(stream)) {
      if (event.kind === 'text') answer.text += event.text;
      else if (event.kind === 'reasoning') answer.reasoning += event.text;
      else if (event.kind === 'error') streamError = event.error;
      else summary = event.summary;
    }
    answer.state = streamError
      ? { kind: 'failed', error: streamError, summary }
      : { kind: 'done', summary };
  } catch (failure) {
    if (request.signal.aborted) {
      answer.state = { kind: 'stopped' };
      return;
    }
    const error = (await playgroundErrorOfFailure(failure)) ?? {
      code: null,
      message: apiErrorMessage(failure, 'The request did not reach the gateway.'),
    };
    answer.state = { kind: 'failed', error, summary: null };
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

function isThinking(message: AssistantMessage): boolean {
  return message.state.kind === 'streaming' && message.text === '';
}

const sessionTotals = computed(() => {
  const totals: {
    requests: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    cost: number | null;
  } = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: null };
  for (const message of conversation.value) {
    if (message.role !== 'assistant' || message.state.kind === 'streaming') continue;
    totals.requests += 1;
    const summary = message.state.kind === 'stopped' ? null : message.state.summary;
    if (!summary) continue;
    totals.input += summary.usage.inputTokens ?? 0;
    totals.output += summary.usage.outputTokens ?? 0;
    totals.cacheRead += summary.usage.cacheReadTokens ?? 0;
    totals.cacheWrite += summary.usage.cacheWriteTokens ?? 0;
    totals.reasoning += summary.usage.reasoningTokens ?? 0;
    if (summary.cost !== null) totals.cost = (totals.cost ?? 0) + summary.cost;
  }
  return totals;
});
const sessionRows = computed(() =>
  [
    { label: 'Input', value: sessionTotals.value.input },
    { label: 'Output', value: sessionTotals.value.output },
    { label: 'Cache read', value: sessionTotals.value.cacheRead },
    { label: 'Cache write', value: sessionTotals.value.cacheWrite },
    { label: 'Reasoning', value: sessionTotals.value.reasoning },
  ].filter((row, index) => index < 2 || row.value > 0),
);

const settingsHint = computed(() =>
  source.value === 'model'
    ? "Empty parameters leave the choice to the Model's Parameter Policy."
    : "Empty parameters aren't sent: a direct test applies no Parameter Policy.",
);

const isCodeOpen = ref(false);
const codeRequest = computed(() => {
  if (source.value === 'upstream') {
    return {
      problem:
        'Client applications reach Upstream Models only through a Model. Switch the source to Model to copy a request.',
    };
  }
  const read = readSettings();
  if ('problem' in read) return { problem: read.problem };
  const pending: PlaygroundMessage[] = hasDraft.value
    ? [
        {
          role: 'user',
          text: promptInput.textInput.value.trim(),
          imageUrls: promptInput.files.value.map((file) => file.url),
        },
      ]
    : [];
  return { body: chatCompletionRequest(read.settings, [...conversation.value, ...pending]) };
});
</script>

<template>
  <div class="bench tw-scope">
    <section class="panel bench__chat" aria-label="Conversation">
      <header class="bench-bar">
        <PlaygroundTargetPicker />
        <p class="bench-bar__params">
          <template v-if="sentParameters.length > 0">
            <span v-for="parameter in sentParameters" :key="parameter" class="chip">{{
              parameter
            }}</span>
          </template>
          <span v-else class="bench-bar__muted">{{
            source === 'model' ? "Parameters from the Model's policy" : 'No parameters: sent as-is'
          }}</span>
        </p>
        <Context
          v-if="sessionTotals.requests > 0"
          :used-tokens="sessionTotals.input + sessionTotals.output"
          :max-tokens="0"
        >
          <ContextTrigger>
            <button class="bench-bar__totals tabular" type="button">
              <span
                >{{ sessionTotals.requests }}
                {{ sessionTotals.requests === 1 ? 'request' : 'requests' }}</span
              >
              <span>{{ formatCount(sessionTotals.input + sessionTotals.output) }} tokens</span>
              <span>{{ formatCost(sessionTotals.cost) }}</span>
            </button>
          </ContextTrigger>
          <ContextContent
            class="w-60 rounded-xl border-[var(--line-soft)] bg-[var(--panel)] shadow-[var(--shadow-float)]"
            align="end"
          >
            <ContextContentBody class="session-card">
              <p class="session-card__title">This tab</p>
              <dl>
                <div v-for="row in sessionRows" :key="row.label">
                  <dt>{{ row.label }}</dt>
                  <dd class="tabular">{{ formatCount(row.value) }}</dd>
                </div>
              </dl>
            </ContextContentBody>
            <ContextContentFooter class="session-card__footer bg-[var(--panel-2)] text-[11px]">
              <span>Cost reported by the gateway</span>
              <strong class="tabular">{{ formatCost(sessionTotals.cost) }}</strong>
            </ContextContentFooter>
          </ContextContent>
        </Context>
        <div class="bench-bar__tools">
          <button
            class="button bench-bar__tool"
            type="button"
            aria-label="Clear the conversation"
            :disabled="conversation.length === 0"
            @click="clearConversation"
          >
            <Trash2 :size="14" /><span>Clear</span>
          </button>
          <button
            class="button bench-bar__tool"
            type="button"
            aria-label="Request as code"
            :disabled="!canTry"
            @click="isCodeOpen = true"
          >
            <Code :size="14" /><span>Code</span>
          </button>
          <button
            class="button bench-bar__tool bench-bar__settings"
            type="button"
            aria-label="Settings"
            @click="isSettingsSheetOpen = true"
          >
            <SlidersHorizontal :size="14" /><span>Settings</span>
          </button>
        </div>
      </header>

      <MarkdownProvider :extensions="markdownExtensions" :is-dark="isDark">
        <Conversation class="bench__log" aria-label="Messages" :initial="false">
          <ConversationContent
            class="gap-[22px] px-6 pt-[22px] pb-7 max-[760px]:px-3.5 max-[760px]:pt-[18px]"
          >
            <PlaygroundTargetPreview :is-log-empty="conversation.length === 0" />

            <Message
              v-for="(message, index) in conversation"
              :key="index"
              :from="message.role"
              :class="
                message.role === 'assistant'
                  ? 'max-w-full'
                  : 'max-w-[min(560px,88%)] max-[760px]:max-w-[92%]'
              "
            >
              <MessageContent
                v-if="message.role === 'user'"
                class="group-[.is-user]:rounded-[14px_14px_4px_14px] group-[.is-user]:bg-[var(--chip)] group-[.is-user]:px-3.5 group-[.is-user]:py-2.5"
              >
                <p v-if="message.text" class="exchange__text">{{ message.text }}</p>
                <div v-if="message.imageUrls.length > 0" class="playground-images">
                  <img
                    v-for="(url, imageIndex) in message.imageUrls"
                    :key="imageIndex"
                    :src="url"
                    alt="Attached image"
                  />
                </div>
              </MessageContent>
              <MessageContent v-else class="w-full max-w-[76ch] gap-2.5">
                <Reasoning
                  v-if="message.reasoning"
                  class="mb-0 rounded-[10px] border border-[var(--line-soft)] bg-[var(--panel-2)] px-3 py-2.5 text-xs [&_button]:text-xs"
                  :is-streaming="isThinking(message)"
                >
                  <ReasoningTrigger />
                  <ReasoningContent :content="message.reasoning" />
                </Reasoning>
                <MessageResponse
                  v-if="message.text"
                  class="exchange__markdown text-[13px] leading-relaxed"
                  :content="message.text"
                />
                <Shimmer
                  v-else-if="isThinking(message) && !message.reasoning"
                  class="exchange__waiting"
                  :duration="1.6"
                  >Waiting for the answer…</Shimmer
                >
                <p v-if="message.state.kind === 'stopped'" class="exchange__note">Stopped.</p>
                <p v-if="message.state.kind === 'failed'" class="exchange__error" role="alert">
                  <span class="status-badge status-badge--bad">{{
                    message.state.error.code ?? 'Error'
                  }}</span>
                  {{ message.state.error.message }}
                </p>
                <PlaygroundReceipt
                  v-if="
                    (message.state.kind === 'done' || message.state.kind === 'failed') &&
                    message.state.summary
                  "
                  :summary="message.state.summary"
                  :routes="routesOf(message)"
                  :direct="isDirect(message)"
                  :provider-names="providerNamesBySlug"
                  :provider-logos="providerLogosBySlug"
                />
              </MessageContent>
            </Message>
          </ConversationContent>
          <ConversationScrollButton
            v-if="conversation.length > 0"
            class="right-3 bottom-3 left-auto translate-x-0 shadow-[var(--shadow-float)]"
          />
        </Conversation>
      </MarkdownProvider>

      <div class="composer">
        <PlaygroundStarters
          v-if="conversation.length === 0 && canTry && !isLoadingSource"
          :can-see-images="canSeeImages"
          @start="start"
        />
        <PromptInput
          v-if="isActivated"
          class="[&_[data-slot=input-group]]:rounded-[14px] [&_[data-slot=input-group]]:bg-[var(--panel)] [&_[data-slot=input-group]]:shadow-[var(--shadow)]"
          multiple
          global-drop
        >
          <PromptInputHeader v-if="promptInput.files.value.length > 0" class="gap-2.5 px-3.5 pt-3">
            <div
              v-for="file in promptInput.files.value"
              :key="file.id"
              class="playground-images__item"
            >
              <img :src="file.url" :alt="file.filename ?? 'Image to send'" />
              <button
                class="icon-button"
                type="button"
                :aria-label="`Remove ${file.filename ?? 'image'}`"
                @click="promptInput.removeFile(file.id)"
              >
                <X :size="12" />
              </button>
            </div>
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              class="px-3.5 pt-3 pb-1 text-[13px] leading-normal text-[var(--ink)] placeholder:text-[var(--placeholder)] max-[760px]:min-h-10 max-[760px]:text-base"
              aria-label="Message"
              placeholder="Message the Model"
            />
          </PromptInputBody>
          <PromptInputFooter class="px-2 pt-1 pb-2">
            <PromptInputTools>
              <PromptInputButton
                class="composer__attach text-xs text-[var(--muted)]"
                @click="promptInput.openFileDialog()"
              >
                <ImagePlus class="size-4" /><span>Attach images</span>
              </PromptInputButton>
              <span class="composer__hint">Enter sends · Shift+Enter adds a line</span>
            </PromptInputTools>
            <PromptInputButton
              v-if="isSending"
              variant="default"
              size="icon-sm"
              aria-label="Stop"
              @click="stop"
            >
              <Square class="size-3.5" />
            </PromptInputButton>
            <PromptInputSubmit v-else aria-label="Send" :disabled="!canSend" />
          </PromptInputFooter>
        </PromptInput>
        <p v-if="composerError" class="form__error" role="alert">{{ composerError }}</p>
      </div>
    </section>

    <section class="panel bench__settings" aria-label="Settings">
      <header class="panel-heading">
        <div>
          <h2>Settings</h2>
          <p>{{ settingsHint }}</p>
        </div>
      </header>
      <div class="panel-body">
        <PlaygroundSettings
          v-model:system-prompt="systemPrompt"
          v-model:temperature="temperature"
          v-model:top-p="topP"
          v-model:max-output-tokens="maxOutputTokens"
          v-model:reasoning-effort="reasoningEffort"
          :reasoning-options="reasoningOptions"
        />
      </div>
    </section>

    <DialogRoot v-model:open="isSettingsSheetOpen">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="sheet tw-scope">
          <header class="sheet__header">
            <div>
              <DialogTitle class="dialog__title">Settings</DialogTitle>
              <DialogDescription class="dialog__description">
                {{ settingsHint }}
              </DialogDescription>
            </div>
            <button
              class="icon-button"
              type="button"
              aria-label="Close settings"
              @click="isSettingsSheetOpen = false"
            >
              <X :size="16" />
            </button>
          </header>
          <PlaygroundSettings
            v-model:system-prompt="systemPrompt"
            v-model:temperature="temperature"
            v-model:top-p="topP"
            v-model:max-output-tokens="maxOutputTokens"
            v-model:reasoning-effort="reasoningEffort"
            :reasoning-options="reasoningOptions"
          />
          <button
            class="button button--primary sheet__done"
            type="button"
            @click="isSettingsSheetOpen = false"
          >
            Done
          </button>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <PlaygroundCodeDialog v-model:open="isCodeOpen" :request="codeRequest" />
  </div>
</template>
