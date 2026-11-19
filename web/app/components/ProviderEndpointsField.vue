<script setup lang="ts">
import { Plus, Trash2 } from "@lucide/vue";
import { type EndpointForm, endpointFormFor } from "~/lib/providerForm";
import {
  ENDPOINT_KIND_OPTIONS,
  MODEL_KIND_LABELS,
  MODEL_KINDS,
  protocolOptionsFor,
} from "~/lib/upstream";

/**
 * Edits a Provider's endpoints: one row per Model Kind it serves, each with
 * the Protocol and base URL for that Kind. Saving replaces the whole list.
 */
const endpoints = defineModel<EndpointForm[]>({ required: true });

/** Another row is useful only while some Kind with a Protocol has no row yet. */
const unusedKinds = computed(() =>
  ENDPOINT_KIND_OPTIONS.filter(
    (option) => !endpoints.value.some((endpoint) => endpoint.kind === option.value),
  ),
);

function kindLabel(kind: string): string {
  const known = MODEL_KINDS.find((modelKind) => modelKind === kind);
  return known ? MODEL_KIND_LABELS[known] : "new";
}

/** A new Kind keeps the Protocol only when it serves that Kind too. */
function handleKindChange(endpoint: EndpointForm, kind: string): void {
  endpoint.kind = kind;
  const protocols = protocolOptionsFor(kind);
  if (!protocols.some((option) => option.value === endpoint.protocol)) {
    endpoint.protocol = protocols[0]?.value ?? "";
  }
}

function handleAdd(): void {
  const kind = unusedKinds.value[0]?.value ?? "";
  endpoints.value.push({
    ...endpointFormFor(),
    kind,
    protocol: protocolOptionsFor(kind)[0]?.value ?? "",
  });
}

function handleRemove(endpoint: EndpointForm): void {
  endpoints.value = endpoints.value.filter((row) => row.key !== endpoint.key);
}
</script>

<template>
  <fieldset class="endpoint-list">
    <legend class="field__label">Endpoints</legend>
    <div class="endpoint-list__head" aria-hidden="true">
      <span class="field__label">Kind</span>
      <span class="field__label">Protocol</span>
      <span class="field__label">Base URL</span>
    </div>
    <div v-for="endpoint in endpoints" :key="endpoint.key" class="endpoint-list__row">
      <AppSelect
        class="endpoint-list__kind"
        :model-value="endpoint.kind"
        :options="ENDPOINT_KIND_OPTIONS"
        label="Endpoint Kind"
        placeholder="Pick a Kind"
        @update:model-value="handleKindChange(endpoint, $event)"
      />
      <AppSelect
        class="endpoint-list__protocol"
        v-model="endpoint.protocol"
        :options="protocolOptionsFor(endpoint.kind)"
        :label="`${kindLabel(endpoint.kind)} Protocol`"
        placeholder="Pick a Protocol"
        empty-text="No Protocol serves this Kind yet"
      />
      <input
        v-model="endpoint.baseUrl"
        class="text-input endpoint-list__url"
        type="url"
        required
        :aria-label="`${kindLabel(endpoint.kind)} base URL`"
        placeholder="https://"
        :title="endpoint.baseUrl"
      />
      <button
        class="icon-button endpoint-list__remove"
        type="button"
        :aria-label="`Remove the ${kindLabel(endpoint.kind)} endpoint`"
        :disabled="endpoints.length === 1"
        @click="handleRemove(endpoint)"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <button
      v-if="unusedKinds.length > 0"
      class="button endpoint-list__add"
      type="button"
      @click="handleAdd"
    >
      <Plus :size="14" /> Add endpoint
    </button>
  </fieldset>
</template>
