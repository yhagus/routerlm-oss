<script setup lang="ts">
import { isPublishedAs } from '~/lib/modelGroups';
import { FileMusic, SlidersHorizontal, Square, Trash2, X } from '@lucide/vue';
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { computed, reactive, ref, useTemplateRef } from 'vue';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { apiErrorMessage } from '~/lib/api';
import { playgroundErrorOfFailure } from '~/lib/playground';
import {
  audioFileProblemOf,
  type PlaygroundTranscriptionSettings,
  type TranscriptionExchange,
  transcriptionAnswerOf,
  transcriptionFormOf,
} from '~/lib/playgroundTranscription';
import { formatCost } from '~/lib/usage';

const { $dashboardApi } = useNuxtApp();
const { source, modelDetail, canTry, requestModel, requestPath } =
  usePlaygroundTarget('transcription');

const language = ref('');
const isSettingsSheetOpen = ref(false);

function readSettings(): { settings: PlaygroundTranscriptionSettings } | { problem: string } {
  const target = requestModel();
  if ('problem' in target) return target;
  return { settings: { model: target.model, language: language.value.trim() } };
}

const fileInput = useTemplateRef('fileInput');
const audioFile = ref<File | null>(null);
const composerError = ref('');

function handleFileChange(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0] ?? null;
  input.value = '';
  if (!file) return;
  const problem = audioFileProblemOf(file);
  if (problem) {
    composerError.value = problem;
    return;
  }
  composerError.value = '';
  audioFile.value = file;
}

const exchanges = ref<TranscriptionExchange[]>([]);
let nextExchangeId = 1;
const runningRequest = ref<AbortController | null>(null);
const isSending = computed(() => runningRequest.value !== null);
const canSend = computed(() => !isSending.value && canTry.value && audioFile.value !== null);

function handleSubmit(): void {
  if (isSending.value) return;
  const file = audioFile.value;
  if (!file) {
    composerError.value = 'Choose an audio file to transcribe.';
    return;
  }
  const read = readSettings();
  if ('problem' in read) {
    composerError.value = read.problem;
    return;
  }
  composerError.value = '';
  audioFile.value = null;
  void send(read.settings, file);
}

async function send(settings: PlaygroundTranscriptionSettings, file: File): Promise<void> {
  const isDirect = source.value === 'upstream';
  const exchange = reactive<TranscriptionExchange>({
    id: nextExchangeId++,
    fileName: file.name,
    language: settings.language,
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
    const payload = await $dashboardApi(requestPath('audio/transcriptions'), {
      method: 'POST',
      body: transcriptionFormOf(settings, file),
      signal: request.signal,
    });
    const answer = transcriptionAnswerOf(payload);
    exchange.state = answer
      ? { kind: 'done', ...answer }
      : { kind: 'failed', error: { code: null, message: "The gateway's answer had no text." } };
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
  let transcripts = 0;
  let cost: number | null = null;
  for (const exchange of exchanges.value) {
    if (exchange.state.kind !== 'done') continue;
    transcripts += 1;
    const exchangeCost = exchange.state.summary.cost;
    if (exchangeCost !== null) cost = (cost ?? 0) + exchangeCost;
  }
  return { transcripts, cost };
});

const settingsHint = 'Leave the language empty to let the model detect it.';
</script>

<template>
  <div class="bench tw-scope">
    <section class="panel bench__chat" aria-label="Transcription">
      <header class="bench-bar">
        <PlaygroundTargetPicker />
        <p class="bench-bar__params">
          <span v-if="language.trim() !== ''" class="chip">Language {{ language.trim() }}</span>
          <span v-else class="bench-bar__muted">Language detected</span>
        </p>
        <p v-if="totals.transcripts > 0" class="bench-bar__totals tabular">
          <span
            >{{ totals.transcripts }}
            {{ totals.transcripts === 1 ? 'transcript' : 'transcripts' }}</span
          >
          <span>{{ formatCost(totals.cost) }}</span>
        </p>
        <div class="bench-bar__tools">
          <button
            class="button bench-bar__tool"
            type="button"
            aria-label="Clear the transcripts"
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

      <Conversation class="bench__log" aria-label="Transcription requests" :initial="false">
        <ConversationContent
          class="gap-[22px] px-6 pt-[22px] pb-7 max-[760px]:px-3.5 max-[760px]:pt-[18px]"
        >
          <PlaygroundTargetPreview :is-log-empty="exchanges.length === 0" />
          <PlaygroundTranscriptionExchange
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

      <form class="composer" @submit.prevent="handleSubmit">
        <div class="transcription-composer">
          <input
            ref="fileInput"
            class="sr-only"
            type="file"
            accept="audio/*"
            aria-label="Audio file"
            @change="handleFileChange"
          />
          <button
            class="button transcription-composer__file"
            type="button"
            @click="fileInput?.click()"
          >
            <FileMusic :size="14" />
            <span>{{ audioFile?.name ?? 'Choose an audio file' }}</span>
          </button>
          <span class="composer__hint">Up to 25 MB</span>
          <button
            v-if="isSending"
            class="button button--primary"
            type="button"
            aria-label="Stop"
            @click="stop"
          >
            <Square :size="14" />
          </button>
          <button v-else class="button button--primary" type="submit" :disabled="!canSend">
            Transcribe
          </button>
        </div>
        <p v-if="composerError" class="form__error" role="alert">{{ composerError }}</p>
      </form>
    </section>

    <section class="panel bench__settings" aria-label="Settings">
      <header class="panel-heading">
        <h2>Settings</h2>
      </header>
      <div class="panel-body">
        <PlaygroundTranscriptionSettings v-model:language="language" />
      </div>
    </section>

    <DialogRoot v-model:open="isSettingsSheetOpen">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="sheet tw-scope">
          <header class="sheet__header">
            <div>
              <DialogTitle class="dialog__title">Settings</DialogTitle>
              <DialogDescription class="sr-only">{{ settingsHint }}</DialogDescription>
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
          <PlaygroundTranscriptionSettings v-model:language="language" />
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
