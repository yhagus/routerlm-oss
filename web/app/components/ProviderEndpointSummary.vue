<script setup lang="ts">
import { AudioLines, Captions, Clapperboard, Image, MessageSquare } from "@lucide/vue";
import type { Component } from "vue";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { baseUrlHost } from "~/lib/providerOverview";
import {
  type ModelKind,
  type ProviderEndpoint,
  MODEL_KIND_LABELS,
  MODEL_KINDS,
  PROTOCOL_LABELS,
} from "~/lib/upstream";

const props = defineProps<{ endpoints: readonly ProviderEndpoint[] }>();

const KIND_ICONS: Record<ModelKind, Component> = {
  chat: MessageSquare,
  image: Image,
  speech: AudioLines,
  transcription: Captions,
  video: Clapperboard,
};

const ordered = computed(() =>
  [...props.endpoints].sort((a, b) => MODEL_KINDS.indexOf(a.kind) - MODEL_KINDS.indexOf(b.kind)),
);

const summary = computed(
  () =>
    `Endpoints: ${ordered.value
      .map(
        (endpoint) => `${MODEL_KIND_LABELS[endpoint.kind]} (${PROTOCOL_LABELS[endpoint.protocol]})`,
      )
      .join(", ")}`,
);
</script>

<template>
  <TooltipProvider :delay-duration="100">
    <span class="endpoint-summary" role="img" :aria-label="summary">
      <Tooltip v-for="endpoint in ordered" :key="endpoint.protocol">
        <TooltipTrigger as-child>
          <span class="endpoint-summary__kind"
            ><component :is="KIND_ICONS[endpoint.kind]" :size="13" aria-hidden="true"
          /></span>
        </TooltipTrigger>
        <TooltipContent class="endpoint-tooltip">
          <strong>{{ MODEL_KIND_LABELS[endpoint.kind] }}</strong>
          <span>{{ PROTOCOL_LABELS[endpoint.protocol] }}</span>
          <span class="endpoint-tooltip__host">{{ baseUrlHost(endpoint.baseUrl) }}</span>
        </TooltipContent>
      </Tooltip>
    </span>
  </TooltipProvider>
</template>
