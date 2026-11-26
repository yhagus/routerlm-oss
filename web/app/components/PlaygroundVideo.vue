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
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
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
import { type PlaygroundError, playgroundErrorOfFailure } from '~/lib/playground';
import {
  DEFAULT_VIDEO_SECONDS,
  isVideoResolution,
  MAX_VIDEO_SEED,
  MODEL_DEFAULT,
  type PlaygroundVideoSettings,
  type RatioChoice,
  type ResolutionChoice,
  submittedVideoJobOf,
  VIDEO_POLL_INTERVAL_MS,
  VIDEO_RESOLUTIONS,
  type VideoExchange,
  type VideoParameters,
  videoAnswerStateOf,
  videoJobPath,
  videoObjectOf,
  videoParameterLabels,
  videoRequestOf,
  waitFor,
} from '~/lib/playgroundVideo';
import { formatCost } from '~/lib/usage';

const { $dashboardApi } = useNuxtApp();
const {
  source,
  modelDetail,
  upstreamModelsOfKind,
  selectedUpstreamModel,
  canTry,
  requestModel,
  requestPath,
} = usePlaygroundTarget('video');

const seconds = ref('');
const resolution = ref<ResolutionChoice>(MODEL_DEFAULT);
const aspectRatio = ref<RatioChoice>(MODEL_DEFAULT);
const seed = ref('');
const isSettingsSheetOpen = ref(false);

const targetUpstreamModels = computed(() => {
  if (source.value === 'upstream') {
    return selectedUpstreamModel.value ? [selectedUpstreamModel.value] : [];
  }
  const routedIds = new Set(
    (modelDetail.value?.routes ?? []).map((route) => route.upstreamModel.id),
  );
  return upstreamModelsOfKind.value.filter((upstreamModel) => routedIds.has(upstreamModel.id));
});

const resolutionOptions = computed(() => {
  const listed = new Set(
    targetUpstreamModels.value.flatMap((upstreamModel) => upstreamModel.resolutions ?? []),
  );
  const resolutions =
    listed.size === 0
      ? VIDEO_RESOLUTIONS
      : VIDEO_RESOLUTIONS.filter((candidate) => listed.has(candidate));
  const options: { value: ResolutionChoice; label: string }[] = [
    { value: MODEL_DEFAULT, label: 'Model default' },
    ...resolutions.map((option) => ({ value: option, label: option })),
  ];
  return options;
});
watch(resolutionOptions, (options) => {
  if (!options.some((option) => option.value === resolution.value)) {
    resolution.value = MODEL_DEFAULT;
  }
});

const durationPlaceholder = computed(() => {
  const targets = targetUpstreamModels.value;
  const minimums = targets.flatMap((target) => target.minDurationSeconds ?? []);
  const maximums = targets.flatMap((target) => target.maxDurationSeconds ?? []);
  const isRangeKnown =
    targets.length > 0 && minimums.length === targets.length && maximums.length === targets.length;
  if (!isRangeKnown) return `Default ${DEFAULT_VIDEO_SECONDS}`;
  return `${Math.min(...minimums)} to ${Math.max(...maximums)}, default ${DEFAULT_VIDEO_SECONDS}`;
});

function wholeNumberField(text: string, min: number, max: number): number | undefined | null {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function readParameters(): { parameters: VideoParameters } | { problem: string } {
  const parsedSeconds = wholeNumberField(seconds.value, 1, Number.MAX_SAFE_INTEGER);
  if (parsedSeconds === null) return { problem: 'Duration must be a whole number of seconds.' };
  const parsedSeed = wholeNumberField(seed.value, 0, MAX_VIDEO_SEED);
  if (parsedSeed === null) return { problem: 'Seed must be a whole number from 0 up.' };
  return {
    parameters: {
      seconds: parsedSeconds,
      resolution: isVideoResolution(resolution.value) ? resolution.value : undefined,
      aspectRatio: aspectRatio.value === MODEL_DEFAULT ? undefined : aspectRatio.value,
      seed: parsedSeed,
    },
  };
}

function readSettings(): { settings: PlaygroundVideoSettings } | { problem: string } {
  const target = requestModel();
  if ('problem' in target) return target;
  const read = readParameters();
  if ('problem' in read) return read;
  return { settings: { model: target.model, ...read.parameters } };
}

const sentParameters = computed(() => {
  const read = readParameters();
  return 'parameters' in read ? videoParameterLabels(read.parameters) : [];
});

const exchanges = ref<VideoExchange[]>([]);
let nextExchangeId = 1;
const composerError = ref('');
const runningSubmit = ref<AbortController | null>(null);
const isSubmitting = computed(() => runningSubmit.value !== null);
let polling = new AbortController();
onBeforeUnmount(() => polling.abort());

const promptInput = usePromptInputProvider({
  onSubmit: submit,
  onError: (error) => (composerError.value = error.message),
});
const canSend = computed(
  () => !isSubmitting.value && canTry.value && promptInput.textInput.value.trim() !== '',
);

async function submit(message: PromptInputMessage): Promise<void> {
  if (isSubmitting.value) return;
  const prompt = message.text.trim();
  if (prompt === '') throw new Error('Describe the video to generate.');
  const read = readSettings();
  if ('problem' in read) throw new Error(read.problem);
  composerError.value = '';
  void send(read.settings, prompt);
}

async function send(settings: PlaygroundVideoSettings, prompt: string): Promise<void> {
  const isDirect = source.value === 'upstream';
  const exchange = reactive<VideoExchange>({
    id: nextExchangeId++,
    prompt,
    parameters: videoParameterLabels(settings),
    isDirect,
    routes:
      !isDirect && modelDetail.value && isPublishedAs(modelDetail.value, settings.model)
        ? modelDetail.value.routes
        : null,
    submittedAt: Date.now(),
    state: { kind: 'submitting' },
  });
  exchanges.value.push(exchange);

  const request = new AbortController();
  runningSubmit.value = request;
  try {
    const payload = await $dashboardApi(requestPath('videos'), {
      method: 'POST',
      body: videoRequestOf(settings, prompt),
      signal: request.signal,
    });
    const job = submittedVideoJobOf(payload);
    if (!job) {
      exchange.state = {
        kind: 'failed',
        error: { code: null, message: "The gateway's answer had no Video Job." },
        summary: null,
      };
      return;
    }
    exchange.state = videoAnswerStateOf(job.video, job.summary);
  } catch (failure) {
    if (request.signal.aborted) {
      exchange.state = { kind: 'stopped' };
      return;
    }
    exchange.state = { kind: 'failed', error: await errorOf(failure), summary: null };
    return;
  } finally {
    runningSubmit.value = null;
  }
  void poll(exchange, polling.signal);
}

async function poll(exchange: VideoExchange, signal: AbortSignal): Promise<void> {
  while (exchange.state.kind === 'running') {
    const { videoId, summary } = exchange.state;
    try {
      await waitFor(VIDEO_POLL_INTERVAL_MS, signal);
      const video = videoObjectOf(await $dashboardApi(videoJobPath(videoId), { signal }));
      exchange.state = video
        ? videoAnswerStateOf(video, summary)
        : {
            kind: 'failed',
            error: { code: null, message: "The gateway's answer was not a Video Job." },
            summary,
          };
    } catch (failure) {
      if (signal.aborted) return;
      exchange.state = { kind: 'failed', error: await errorOf(failure), summary };
    }
  }
}

async function errorOf(failure: unknown): Promise<PlaygroundError> {
  return (
    (await playgroundErrorOfFailure(failure)) ?? {
      code: null,
      message: apiErrorMessage(failure, 'The request did not reach the gateway.'),
    }
  );
}

function stop(): void {
  runningSubmit.value?.abort();
}

function clearHistory(): void {
  stop();
  polling.abort();
  polling = new AbortController();
  exchanges.value = [];
}

const totals = computed(() => {
  let jobs = 0;
  let cost: number | null = null;
  for (const exchange of exchanges.value) {
    if (!('summary' in exchange.state) || !exchange.state.summary) continue;
    jobs += 1;
    const jobCost = exchange.state.summary.cost;
    if (jobCost !== null) cost = (cost ?? 0) + jobCost;
  }
  return { jobs, cost };
});

const settingsHint =
  "Empty fields aren't sent, so the gateway's defaults apply. The Cost is charged when a Video Job is accepted.";
</script>

<template>
  <div class="bench tw-scope">
    <section class="panel bench__chat" aria-label="Video">
      <header class="bench-bar">
        <PlaygroundTargetPicker />
        <p class="bench-bar__params">
          <span v-for="parameter in sentParameters" :key="parameter" class="chip">{{
            parameter
          }}</span>
        </p>
        <p v-if="totals.jobs > 0" class="bench-bar__totals tabular">
          <span>{{ totals.jobs }} {{ totals.jobs === 1 ? 'video' : 'videos' }}</span>
          <span>{{ formatCost(totals.cost) }}</span>
        </p>
        <div class="bench-bar__tools">
          <button
            class="button bench-bar__tool"
            type="button"
            aria-label="Clear the videos"
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

      <Conversation class="bench__log" aria-label="Video Jobs" :initial="false">
        <ConversationContent
          class="gap-[22px] px-6 pt-[22px] pb-7 max-[760px]:px-3.5 max-[760px]:pt-[18px]"
        >
          <PlaygroundTargetPreview :is-log-empty="exchanges.length === 0" />
          <PlaygroundVideoExchange
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
              aria-label="Video prompt"
              placeholder="Describe the video to generate"
            />
          </PromptInputBody>
          <PromptInputFooter class="px-2 pt-1 pb-2">
            <PromptInputTools>
              <span class="composer__hint">Enter submits · Shift+Enter adds a line</span>
            </PromptInputTools>
            <PromptInputButton
              v-if="isSubmitting"
              variant="default"
              size="icon-sm"
              aria-label="Stop"
              @click="stop"
            >
              <Square class="size-3.5" />
            </PromptInputButton>
            <PromptInputSubmit v-else aria-label="Submit" :disabled="!canSend" />
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
        <PlaygroundVideoSettings
          v-model:seconds="seconds"
          v-model:resolution="resolution"
          v-model:aspect-ratio="aspectRatio"
          v-model:seed="seed"
          :resolution-options="resolutionOptions"
          :duration-placeholder="durationPlaceholder"
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
          <PlaygroundVideoSettings
            v-model:seconds="seconds"
            v-model:resolution="resolution"
            v-model:aspect-ratio="aspectRatio"
            v-model:seed="seed"
            :resolution-options="resolutionOptions"
            :duration-placeholder="durationPlaceholder"
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
  </div>
</template>
