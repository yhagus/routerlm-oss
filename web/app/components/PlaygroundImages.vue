<script setup lang="ts">
import { ImagePlus, SlidersHorizontal, Square, Trash2, X } from '@lucide/vue';
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
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
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
import { apiErrorMessage } from '~/lib/api';
import { MAX_IMAGE_BYTES, playgroundErrorOfFailure } from '~/lib/playground';
import {
  AUTOMATIC_SIZE,
  clientSizeOf,
  type ImageExchange,
  imageAnswerOf,
  imageRequestOf,
  MAX_IMAGES_PER_REQUEST,
  MAX_SEED,
  type PlaygroundImageSettings,
} from '~/lib/playgroundImages';
import { formatCost } from '~/lib/usage';

const { $dashboardApi } = useNuxtApp();
const {
  source,
  selectedUpstreamModel,
  upstreamModelsOfKind,
  modelDetail,
  canTry,
  requestModel,
  requestPath,
} = usePlaygroundTarget('image');

const size = ref(AUTOMATIC_SIZE);
const count = ref('');
const negativePrompt = ref('');
const seed = ref('');
const isSettingsSheetOpen = ref(false);

const targetSizes = computed(() => {
  if (source.value === 'upstream') return selectedUpstreamModel.value?.sizes ?? [];
  const routedIds = new Set(
    (modelDetail.value?.routes ?? []).map((route) => route.upstreamModel.id),
  );
  const sizes = upstreamModelsOfKind.value
    .filter((upstreamModel) => routedIds.has(upstreamModel.id))
    .flatMap((upstreamModel) => upstreamModel.sizes ?? []);
  return [...new Set(sizes)];
});
const sizeOptions = computed(() =>
  targetSizes.value.length === 0
    ? []
    : [
        { value: AUTOMATIC_SIZE, label: 'Model default' },
        ...targetSizes.value.map((upstreamSize) => ({
          value: clientSizeOf(upstreamSize),
          label: clientSizeOf(upstreamSize),
        })),
      ],
);
watch(sizeOptions, (options) => {
  if (options.length > 0 && !options.some((option) => option.value === size.value)) {
    size.value = AUTOMATIC_SIZE;
  }
});

function wholeNumberField(text: string, min: number, max: number): number | undefined | null {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function readSettings(): { settings: PlaygroundImageSettings } | { problem: string } {
  const target = requestModel();
  if ('problem' in target) return target;
  const parsedCount = wholeNumberField(count.value, 1, MAX_IMAGES_PER_REQUEST);
  if (parsedCount === null) {
    return { problem: `Images must be a whole number from 1 to ${MAX_IMAGES_PER_REQUEST}.` };
  }
  const parsedSeed = wholeNumberField(seed.value, 0, MAX_SEED);
  if (parsedSeed === null) return { problem: 'Seed must be a whole number from 0 up.' };
  const typedSize = size.value.trim();
  return {
    settings: {
      model: target.model,
      size: typedSize === '' || typedSize === AUTOMATIC_SIZE ? undefined : typedSize,
      count: parsedCount,
      negativePrompt: negativePrompt.value.trim() || undefined,
      seed: parsedSeed,
    },
  };
}

const sentParameters = computed(() => {
  const parameters: string[] = [];
  const typedSize = size.value.trim();
  if (typedSize !== '' && typedSize !== AUTOMATIC_SIZE) parameters.push(typedSize);
  if (count.value.trim() !== '') parameters.push(`${count.value} images`);
  if (negativePrompt.value.trim() !== '') parameters.push('Negative prompt');
  if (seed.value.trim() !== '') parameters.push(`Seed ${seed.value}`);
  return parameters;
});

const exchanges = ref<ImageExchange[]>([]);
let nextExchangeId = 1;
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
const canSend = computed(
  () => !isSending.value && canTry.value && promptInput.textInput.value.trim() !== '',
);
const isActivated = useIsActivated();

async function submit(message: PromptInputMessage): Promise<void> {
  if (isSending.value) return;
  const prompt = message.text.trim();
  if (prompt === '') throw new Error('Describe the image to make.');
  const read = readSettings();
  if ('problem' in read) throw new Error(read.problem);
  composerError.value = '';
  void send(
    read.settings,
    prompt,
    message.files.map((file) => file.url),
  );
}

async function send(
  settings: PlaygroundImageSettings,
  prompt: string,
  inputImageUrls: string[],
): Promise<void> {
  const { operation, endpoint, body } = imageRequestOf(settings, prompt, inputImageUrls);
  const isDirect = source.value === 'upstream';
  const exchange = reactive<ImageExchange>({
    id: nextExchangeId++,
    prompt,
    inputImageUrls,
    operation,
    isDirect,
    routes:
      !isDirect && modelDetail.value?.name === settings.model ? modelDetail.value.routes : null,
    state: { kind: 'pending' },
  });
  exchanges.value.push(exchange);

  const request = new AbortController();
  runningRequest.value = request;
  try {
    const payload = await $dashboardApi(requestPath(endpoint), {
      method: 'POST',
      body,
      signal: request.signal,
    });
    const answer = imageAnswerOf(payload);
    exchange.state = answer
      ? { kind: 'done', ...answer }
      : { kind: 'failed', error: { code: null, message: "The gateway's answer had no images." } };
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
  let images = 0;
  let cost: number | null = null;
  for (const exchange of exchanges.value) {
    if (exchange.state.kind !== 'done') continue;
    images += exchange.state.imageUrls.length;
    const exchangeCost = exchange.state.summary.cost;
    if (exchangeCost !== null) cost = (cost ?? 0) + exchangeCost;
  }
  return { images, cost };
});

const settingsHint = "Empty parameters aren't sent, so the model decides.";
</script>

<template>
  <div class="bench tw-scope">
    <section class="panel bench__chat" aria-label="Images">
      <header class="bench-bar">
        <PlaygroundTargetPicker />
        <p class="bench-bar__params">
          <template v-if="sentParameters.length > 0">
            <span v-for="parameter in sentParameters" :key="parameter" class="chip">{{
              parameter
            }}</span>
          </template>
          <span v-else class="bench-bar__muted">Size and count from the model</span>
        </p>
        <p v-if="totals.images > 0" class="bench-bar__totals tabular">
          <span>{{ totals.images }} {{ totals.images === 1 ? 'image' : 'images' }}</span>
          <span>{{ formatCost(totals.cost) }}</span>
        </p>
        <div class="bench-bar__tools">
          <button
            class="button bench-bar__tool"
            type="button"
            aria-label="Clear the images"
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

      <Conversation class="bench__log" aria-label="Image requests" :initial="false">
        <ConversationContent
          class="gap-[22px] px-6 pt-[22px] pb-7 max-[760px]:px-3.5 max-[760px]:pt-[18px]"
        >
          <PlaygroundTargetPreview :is-log-empty="exchanges.length === 0" />
          <PlaygroundImageExchange
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
              <img :src="file.url" :alt="file.filename ?? 'Image to edit'" />
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
              aria-label="Prompt"
              :placeholder="
                promptInput.files.value.length > 0
                  ? 'Describe how to change the images'
                  : 'Describe the image to make'
              "
            />
          </PromptInputBody>
          <PromptInputFooter class="px-2 pt-1 pb-2">
            <PromptInputTools>
              <PromptInputButton
                class="composer__attach text-xs text-[var(--muted)]"
                @click="promptInput.openFileDialog()"
              >
                <ImagePlus class="size-4" /><span>Attach images to edit</span>
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
        <PlaygroundImageSettings
          v-model:size="size"
          v-model:count="count"
          v-model:negative-prompt="negativePrompt"
          v-model:seed="seed"
          :size-options="sizeOptions"
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
          <PlaygroundImageSettings
            v-model:size="size"
            v-model:count="count"
            v-model:negative-prompt="negativePrompt"
            v-model:seed="seed"
            :size-options="sizeOptions"
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
