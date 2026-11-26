<script setup lang="ts">
import type { ModelKind } from '~/lib/upstream';
import type { MediaForm } from '~/lib/upstreamModelMedia';

defineProps<{ kind: ModelKind }>();
const form = defineModel<MediaForm>({ required: true });
</script>

<template>
  <template v-if="kind === 'image'">
    <div class="form__grid">
      <label class="field"
        ><span class="field__label">Price per image</span
        ><NumberInput
          v-model="form.pricePerImage"
          class="text-input"
          :min="0"
          prefix="$"
          suffix="/ image"
          unit-label="US dollars per generated image"
      /></label>
      <label class="field"
        ><span class="field__label">Price per input image</span
        ><NumberInput
          v-model="form.pricePerInputImage"
          class="text-input"
          :min="0"
          prefix="$"
          suffix="/ image"
          unit-label="US dollars per input image"
      /></label>
    </div>
    <PricesByTierInput
      v-model="form.pricePerImageBySize"
      tier-label="Size tier"
      suffix="/ image"
      unit-label="US dollars per generated image"
    />
    <p class="form__hint">
      A price by size tier, such as 2K, for a Provider whose price depends on the size.
    </p>
  </template>

  <template v-if="kind === 'video'">
    <PricesByTierInput
      v-model="form.pricePerSecondByResolution"
      tier-label="Resolution"
      suffix="/ second"
      unit-label="US dollars per output second"
    />
    <p class="form__hint">The price per second of output video, by resolution, such as 720P.</p>
    <div class="form__grid">
      <label class="field"
        ><span class="field__label">Shortest duration (seconds)</span
        ><NumberInput v-model="form.minDurationSeconds" class="text-input" whole :min="1"
      /></label>
      <label class="field"
        ><span class="field__label">Longest duration (seconds)</span
        ><NumberInput v-model="form.maxDurationSeconds" class="text-input" whole :min="1"
      /></label>
    </div>
    <div class="field">
      <span class="field__label">Resolutions</span>
      <TagListInput
        v-model="form.resolutions"
        label="Resolutions"
        placeholder="Resolution, such as 720P, then Enter"
      />
    </div>
  </template>

  <label v-if="kind === 'image' || kind === 'video'" class="field"
    ><span class="field__label">Max input images</span
    ><NumberInput v-model="form.maxInputImages" class="text-input" whole :min="0"
  /></label>

  <div v-if="kind === 'image'" class="field">
    <span class="field__label">Sizes</span>
    <TagListInput
      v-model="form.sizes"
      label="Sizes"
      placeholder="Size, such as 1024*1024, then Enter"
    />
  </div>

  <label v-if="kind === 'speech'" class="field"
    ><span class="field__label">Price per million characters</span
    ><NumberInput
      v-model="form.pricePerMillionCharacters"
      class="text-input"
      :min="0"
      prefix="$"
      suffix="/ 1M characters"
      unit-label="US dollars per million input characters"
  /></label>

  <label v-if="kind === 'transcription'" class="field"
    ><span class="field__label">Price per audio second</span
    ><NumberInput
      v-model="form.pricePerAudioSecond"
      class="text-input"
      :min="0"
      prefix="$"
      suffix="/ second"
      unit-label="US dollars per second of input audio"
  /></label>
</template>
