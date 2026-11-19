<script setup lang="ts">
import { ref } from "vue";
import { MODEL_KIND_LABELS, type ModelKind } from "~/lib/upstream";

useHead({ title: "Playground" });

/** The Kinds the Playground can test; each has its own tab component below. */
const PLAYGROUND_KINDS = [
  "chat",
  "image",
  "speech",
  "video",
] as const satisfies readonly ModelKind[];
type PlaygroundKind = (typeof PLAYGROUND_KINDS)[number];

const kind = ref<PlaygroundKind>("chat");
</script>

<template>
  <div class="page-view playground-page">
    <PageHeading
      title="Playground"
      description="Send requests to a Model through the same path client applications use, or straight to one Upstream Model. Each tab's history stays in this browser tab."
    >
      <div class="segmented" role="group" aria-label="Kind">
        <button
          v-for="option in PLAYGROUND_KINDS"
          :key="option"
          class="segmented__option"
          type="button"
          :aria-pressed="kind === option"
          @click="kind = option"
        >
          {{ MODEL_KIND_LABELS[option] }}
        </button>
      </div>
    </PageHeading>

    <!-- Kept alive, so switching Kinds keeps each tab's history and settings. -->
    <KeepAlive>
      <PlaygroundChat v-if="kind === 'chat'" />
      <PlaygroundImages v-else-if="kind === 'image'" />
      <PlaygroundSpeech v-else-if="kind === 'speech'" />
      <PlaygroundVideo v-else-if="kind === 'video'" />
    </KeepAlive>
  </div>
</template>
