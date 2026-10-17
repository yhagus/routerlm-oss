<script setup lang="ts">
// Port of v1 CapacityBadges — renders small icon badges for model capabilities.
const CAPACITY_META: Record<
  string,
  { icon: string; label: string; desc: string; color: string }
> = {
  vision: {
    icon: "visibility",
    label: "Vision",
    desc: "Supports image input",
    color: "text-blue-500",
  },
  reasoning: {
    icon: "neurology",
    label: "Reasoning",
    desc: "Supports reasoning / thinking",
    color: "text-amber-500",
  },
  search: {
    icon: "travel_explore",
    label: "Web Search",
    desc: "Built-in web search / grounding",
    color: "text-green-500",
  },
  audioInput: {
    icon: "graphic_eq",
    label: "Audio Input",
    desc: "Supports audio input",
    color: "text-purple-500",
  },
  imageOutput: {
    icon: "photo_camera",
    label: "Image Output",
    desc: "Can generate images",
    color: "text-pink-500",
  },
};

const props = defineProps<{
  caps?: Record<string, unknown> | null;
  colorOverride?: string;
  size?: number;
}>();

const active = () =>
  Object.keys(CAPACITY_META).filter((key) => props.caps?.[key]);
</script>

<template>
  <span v-if="caps && active().length" class="inline-flex items-center gap-0.5">
    <span
      v-for="key in active()"
      :key="key"
      class="material-symbols-outlined cursor-help leading-none"
      :class="colorOverride || CAPACITY_META[key].color"
      :style="{ fontSize: `${size ?? 16}px` }"
      :title="`${CAPACITY_META[key].label} — ${CAPACITY_META[key].desc}`"
      >{{ CAPACITY_META[key].icon }}</span
    >
  </span>
</template>
