<script setup lang="ts">
import { ImagePlus, Play } from "@lucide/vue";

defineProps<{ canSeeImages: boolean }>();
const emit = defineEmits<{ start: [prompt: string, withImage: boolean] }>();

const STARTERS = [
  { label: "Say hello", prompt: "Say hello in one sentence." },
  {
    label: "Which model are you?",
    prompt: "Which model are you, and which company trained you? Answer in one sentence.",
  },
  { label: "Count to 20", prompt: "Count from 1 to 20, one number per line." },
];
const IMAGE_STARTER = "Describe this image in one sentence.";
</script>

<template>
  <div class="starters" role="group" aria-label="Starter prompts">
    <span class="starters__label">Try</span>
    <button
      v-for="starter in STARTERS"
      :key="starter.label"
      class="button starter"
      type="button"
      :title="starter.prompt"
      @click="emit('start', starter.prompt, false)"
    >
      <Play :size="13" /> {{ starter.label }}
    </button>
    <button
      v-if="canSeeImages"
      class="button starter"
      type="button"
      :title="`${IMAGE_STARTER} Asks for an image first.`"
      @click="emit('start', IMAGE_STARTER, true)"
    >
      <ImagePlus :size="13" /> Describe an image
    </button>
  </div>
</template>
