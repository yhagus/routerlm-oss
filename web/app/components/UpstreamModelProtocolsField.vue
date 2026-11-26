<script setup lang="ts">
import { ChevronDown, ChevronUp, Plus, X } from "@lucide/vue";
import {
  MODEL_KIND_LABELS,
  type ModelKind,
  PROTOCOL_LABELS,
  type UpstreamProtocol,
} from "~/lib/upstream";

const props = defineProps<{
  endpointProtocols: readonly UpstreamProtocol[];
  kind: ModelKind;
}>();

const protocols = defineModel<UpstreamProtocol[]>({ required: true });

const unlisted = computed(() =>
  props.endpointProtocols.filter((protocol) => !protocols.value.includes(protocol)),
);

const hint = computed(() => {
  const kind = MODEL_KIND_LABELS[props.kind].toLowerCase();
  const firstEndpoint = props.endpointProtocols[0];
  if (protocols.value.length === 0 && firstEndpoint) {
    return `Uses the Provider's first ${kind} endpoint (${PROTOCOL_LABELS[firstEndpoint]}).`;
  }
  return "A request goes out on the client's Protocol when it is listed, otherwise on the first one.";
});

function handleAdd(protocol: UpstreamProtocol): void {
  protocols.value = [...protocols.value, protocol];
}

function handleRemove(protocol: UpstreamProtocol): void {
  protocols.value = protocols.value.filter((listed) => listed !== protocol);
}

function handleMove(from: number, to: number): void {
  const reordered = [...protocols.value];
  const [moved] = reordered.splice(from, 1);
  if (moved === undefined) return;
  reordered.splice(to, 0, moved);
  protocols.value = reordered;
}
</script>

<template>
  <fieldset class="protocol-order">
    <legend class="field__label">Provider Endpoints</legend>
    <ol v-if="protocols.length > 0" class="protocol-order__list">
      <li v-for="(protocol, index) in protocols" :key="protocol" class="protocol-order__item">
        <span class="protocol-order__name">{{ PROTOCOL_LABELS[protocol] }}</span>
        <button
          class="icon-button"
          type="button"
          :aria-label="`Move ${PROTOCOL_LABELS[protocol]} up`"
          :disabled="index === 0"
          @click="handleMove(index, index - 1)"
        >
          <ChevronUp :size="14" />
        </button>
        <button
          class="icon-button"
          type="button"
          :aria-label="`Move ${PROTOCOL_LABELS[protocol]} down`"
          :disabled="index === protocols.length - 1"
          @click="handleMove(index, index + 1)"
        >
          <ChevronDown :size="14" />
        </button>
        <button
          class="icon-button"
          type="button"
          :aria-label="`Remove ${PROTOCOL_LABELS[protocol]}`"
          @click="handleRemove(protocol)"
        >
          <X :size="14" />
        </button>
      </li>
    </ol>
    <div v-if="unlisted.length > 0" class="protocol-order__add">
      <button
        v-for="protocol in unlisted"
        :key="protocol"
        class="button"
        type="button"
        @click="handleAdd(protocol)"
      >
        <Plus :size="14" /> {{ PROTOCOL_LABELS[protocol] }}
      </button>
    </div>
  </fieldset>
  <p class="form__hint">{{ hint }}</p>
</template>
