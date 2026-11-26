<script setup lang="ts">
import { AUDIO_FORMAT_LABELS, AUDIO_FORMATS, type AudioFormat } from '~/lib/playgroundSpeech';

const voice = defineModel<string>('voice', { required: true });
const format = defineModel<AudioFormat>('format', { required: true });

const formatOptions = AUDIO_FORMATS.map((option) => ({
  value: option,
  label: AUDIO_FORMAT_LABELS[option],
}));
</script>

<template>
  <div class="form playground-settings">
    <div class="playground-settings__grid">
      <label class="field">
        <span class="field__label">Voice</span>
        <input
          v-model="voice"
          class="text-input"
          type="text"
          placeholder="The Provider's name, e.g. Cherry"
        />
      </label>
      <div class="field">
        <span class="field__label">Format</span>
        <AppSelect v-model="format" :options="formatOptions" label="Format" />
      </div>
    </div>
  </div>
</template>
