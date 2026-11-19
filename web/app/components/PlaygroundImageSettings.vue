<script setup lang="ts">
import { MAX_IMAGES_PER_REQUEST, MAX_SEED } from "~/lib/playgroundImages";

/**
 * The image tab's request parameters, in the side rail and the narrow-screen
 * sheet alike. Empty fields aren't sent, so the model decides.
 */
defineProps<{
  /** The sizes the target lists, `auto` first; empty when it lists none, so any can be typed. */
  sizeOptions: { value: string; label: string }[];
}>();

const size = defineModel<string>("size", { required: true });
const count = defineModel<string>("count", { required: true });
const negativePrompt = defineModel<string>("negativePrompt", { required: true });
const seed = defineModel<string>("seed", { required: true });
</script>

<template>
  <div class="form playground-settings">
    <div class="playground-settings__grid">
      <div v-if="sizeOptions.length > 0" class="field">
        <span class="field__label">Size</span>
        <AppSelect v-model="size" :options="sizeOptions" label="Size" />
      </div>
      <label v-else class="field">
        <span class="field__label">Size</span>
        <input v-model="size" class="text-input" type="text" placeholder="e.g. 1024x1024" />
      </label>
      <label class="field">
        <span class="field__label">Images</span>
        <NumberInput
          v-model="count"
          class="text-input"
          whole
          :min="1"
          :max="MAX_IMAGES_PER_REQUEST"
          :placeholder="`1 to ${MAX_IMAGES_PER_REQUEST}`"
        />
      </label>
      <label class="field">
        <span class="field__label">Seed</span>
        <NumberInput
          v-model="seed"
          class="text-input"
          whole
          :min="0"
          :max="MAX_SEED"
          placeholder="Random"
        />
      </label>
    </div>
    <label class="field">
      <span class="field__label">Negative prompt</span>
      <textarea
        v-model="negativePrompt"
        class="text-input text-area"
        rows="3"
        placeholder="Optional. What the image should not show."
      />
    </label>
  </div>
</template>
