<script setup lang="ts">
import {
  MAX_VIDEO_SEED,
  RATIO_OPTIONS,
  type RatioChoice,
  type ResolutionChoice,
} from '~/lib/playgroundVideo';

defineProps<{
  resolutionOptions: { value: ResolutionChoice; label: string }[];
  durationPlaceholder: string;
}>();

const seconds = defineModel<string>('seconds', { required: true });
const resolution = defineModel<ResolutionChoice>('resolution', { required: true });
const aspectRatio = defineModel<RatioChoice>('aspectRatio', { required: true });
const seed = defineModel<string>('seed', { required: true });
</script>

<template>
  <div class="form playground-settings">
    <div class="playground-settings__grid">
      <label class="field">
        <span class="field__label">Duration (seconds)</span>
        <NumberInput
          v-model="seconds"
          class="text-input"
          whole
          :min="1"
          :placeholder="durationPlaceholder"
        />
      </label>
      <div class="field">
        <span class="field__label">Resolution</span>
        <AppSelect v-model="resolution" :options="resolutionOptions" label="Resolution" />
      </div>
      <div class="field">
        <span class="field__label">Aspect ratio</span>
        <AppSelect v-model="aspectRatio" :options="RATIO_OPTIONS" label="Aspect ratio" />
      </div>
      <label class="field">
        <span class="field__label">Seed</span>
        <NumberInput
          v-model="seed"
          class="text-input"
          whole
          :min="0"
          :max="MAX_VIDEO_SEED"
          placeholder="Random"
        />
      </label>
    </div>
  </div>
</template>
