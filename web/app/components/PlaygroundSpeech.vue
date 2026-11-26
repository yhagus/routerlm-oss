<script setup lang="ts">
import { isPublishedAs } from '~/lib/modelGroups';
import { SlidersHorizontal, Square, Trash2, X } from '@lucide/vue';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { computed, reactive, ref } from 'vue';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputProvider,
} from '@/components/ai-elements/prompt-input';
import { apiErrorMessage } from '~/lib/api';
import { playgroundErrorOfFailure } from '~/lib/playground';
import {
  AUDIO_FORMAT_LABELS,
  type AudioFormat,
  DEFAULT_AUDIO_FORMAT,
  type PlaygroundSpeechSettings,
  type SpeechExchange,
  speechAnswerOf,
  speechRequestOf,
} from '~/lib/playgroundSpeech';
import { formatCost } from '~/lib/usage';

const { $dashboardApi } = useNuxtApp();
const { source, modelDetail, canTry, requestModel, requestPath } = usePlaygroundTarget('speech');

const voice = ref('');
const format = ref<AudioFormat>(DEFAULT_AUDIO_FORMAT);
const isSettingsSheetOpen = ref(false);

function readSettings(): { settings: PlaygroundSpeechSettings } | { problem: string } {
  const target = requestModel();
  if ('problem' in target) return target;
  const typedVoice = voice.value.trim();
  if (typedVoice === '') return { problem: 'Enter a voice in Settings.' };
  return { settings: { model: target.model, voice: typedVoice, format: format.value } };
}

const exchanges = ref<SpeechExchange[]>([]);
let nextExchangeId = 1;
const composerError = ref('');
const runningRequest = ref<AbortController | null>(null);
const isSending = computed(() => runningRequest.value !== null);

const promptInput = usePromptInputProvider({
  onSubmit: submit,
  onError: (error) => (composerError.value = error.message),
});
const canSend = computed(
  () => !isSending.value && canTry.value && promptInput.textInput.value.trim() !== '',
);

async function submit(message: PromptInputMessage): Promise<void> {
  if (isSending.value) return;
  const text = message.text.trim();
  if (text === '') throw new Error('Type the text to speak.');
  const read = readSettings();
  if ('problem' in read) throw new Error(read.problem);
  composerError.value = '';
  void send(read.settings, text);
}

async function send(settings: PlaygroundSpeechSettings, text: string): Promise<void> {
  const isDirect = source.value === 'upstream';
  const exchange = reactive<SpeechExchange>({
    id: nextExchangeId++,
    text,
    voice: settings.voice,
    format: settings.format,
    isDirect,
    routes:
      !isDirect && modelDetail.value && isPublishedAs(modelDetail.value, settings.model)
        ? modelDetail.value.routes
        : null,
    state: { kind: 'pending' },
  });
  exchanges.value.push(exchange);

  const request = new AbortController();
  runningRequest.value = request;
  try {
    const payload = await $dashboardApi(requestPath('audio/speech'), {
      method: 'POST',
      body: speechRequestOf(settings, text),
      signal: request.signal,
    });
    const answer = speechAnswerOf(payload);
    exchange.state = answer
      ? { kind: 'done', ...answer }
      : { kind: 'failed', error: { code: null, message: "The gateway's answer had no audio." } };
  } catch (failure) {
    if (request.signal.aborted) {
      exchange.state = { kind: 'stopped' };
      return;
    }
    const error = (await playgroundErrorOfFailure(failure)) ?? {
      code: null,
      message: apiErrorMessage(failure, 'The request did not reach the gateway.'),
    };
    exchange.state = { kind: 'failed', error };
  } finally {
    runningRequest.value = null;
  }
}

function stop(): void {
  runningRequest.value?.abort();
}

function clearHistory(): void {
  stop();
  exchanges.value = [];
}

const totals = computed(() => {
  let clips = 0;
  let cost: number | null = null;
  for (const exchange of exchanges.value) {
    if (exchange.state.kind !== 'done') continue;
    clips += 1;
    const exchangeCost = exchange.state.summary.cost;
    if (exchangeCost !== null) cost = (cost ?? 0) + exchangeCost;
  }
  return { clips, cost };
});

const settingsHint = "The voice is the Provider's own name for it, sent unchanged.";
</script>

<template>
  <div class="bench tw-scope">
    <section class="panel bench__chat" aria-label="Speech">
      <header class="bench-bar">
        <PlaygroundTargetPicker />
        <p class="bench-bar__params">
          <span v-if="voice.trim() !== ''" class="chip">Voice {{ voice.trim() }}</span>
          <span v-else class="bench-bar__muted">No voice yet</span>
          <span class="chip">{{ AUDIO_FORMAT_LABELS[format] }}</span>
        </p>
        <p v-if="totals.clips > 0" class="bench-bar__totals tabular">
          <span>{{ totals.clips }} {{ totals.clips === 1 ? 'clip' : 'clips' }}</span>
          <span>{{ formatCost(totals.cost) }}</span>
        </p>
        <div class="bench-bar__tools">
          <button
            class="button bench-bar__tool"
            type="button"
            aria-label="Clear the speech"
            :disabled="exchanges.length === 0"
            @click="clearHistory"
          >
            <Trash2 :size="14" /><span>Clear</span>
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

      <Conversation class="bench__log" aria-label="Speech requests" :initial="false">
        <ConversationContent
          class="gap-[22px] px-6 pt-[22px] pb-7 max-[760px]:px-3.5 max-[760px]:pt-[18px]"
        >
          <PlaygroundTargetPreview :is-log-empty="exchanges.length === 0" />
          <PlaygroundSpeechExchange
            v-for="exchange in exchanges"
            :key="exchange.id"
            :exchange="exchange"
          />
        </ConversationContent>
        <ConversationScrollButton
          v-if="exchanges.length > 0"
          class="right-3 bottom-3 left-auto translate-x-0 shadow-[var(--shadow-float)]"
        />
      </Conversation>

      <div class="composer">
        <PromptInput
          class="[&_[data-slot=input-group]]:rounded-[14px] [&_[data-slot=input-group]]:bg-[var(--panel)] [&_[data-slot=input-group]]:shadow-[var(--shadow)]"
        >
          <PromptInputBody>
            <PromptInputTextarea
              class="px-3.5 pt-3 pb-1 text-[13px] leading-normal text-[var(--ink)] placeholder:text-[var(--placeholder)] max-[760px]:min-h-10 max-[760px]:text-base"
              aria-label="Text to speak"
              placeholder="Type the text to speak"
            />
          </PromptInputBody>
          <PromptInputFooter class="px-2 pt-1 pb-2">
            <PromptInputTools>
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
        <PlaygroundSpeechSettings v-model:voice="voice" v-model:format="format" />
      </div>
    </section>

    <DialogRoot v-model:open="isSettingsSheetOpen">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="sheet tw-scope">
          <header class="sheet__header">
            <div>
              <DialogTitle class="dialog__title">Settings</DialogTitle>
              <DialogDescription class="dialog__description">{{ settingsHint }}</DialogDescription>
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
          <PlaygroundSpeechSettings v-model:voice="voice" v-model:format="format" />
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
  </div>
</template>
