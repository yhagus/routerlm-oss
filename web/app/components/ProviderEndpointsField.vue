<script setup lang="ts">
import { Plus, Trash2 } from "@lucide/vue";
import { type EndpointForm, endpointFormFor } from "~/lib/providerForm";
import {
  ENDPOINT_KIND_OPTIONS,
  MODEL_KIND_LABELS,
  MODEL_KINDS,
  PROTOCOL_LABELS,
  protocolOptionsFor,
  UPSTREAM_PROTOCOLS,
} from "~/lib/upstream";

const endpoints = defineModel<EndpointForm[]>({ required: true });

const addableKinds = computed(() =>
  ENDPOINT_KIND_OPTIONS.filter((option) => freeProtocolsFor(option.value).length > 0),
);

function freeProtocolsFor(kind: string, endpoint?: EndpointForm) {
  return protocolOptionsFor(kind).filter(
    (option) =>
      !endpoints.value.some((row) => row.key !== endpoint?.key && row.protocol === option.value),
  );
}

function kindOptionsFor(endpoint: EndpointForm) {
  return ENDPOINT_KIND_OPTIONS.filter(
    (option) =>
      option.value === endpoint.kind || freeProtocolsFor(option.value, endpoint).length > 0,
  );
}

function kindLabel(kind: string): string {
  const known = MODEL_KINDS.find((modelKind) => modelKind === kind);
  return known ? MODEL_KIND_LABELS[known] : "new";
}

function endpointLabel(endpoint: EndpointForm): string {
  const protocol = UPSTREAM_PROTOCOLS.find((known) => known === endpoint.protocol);
  return protocol
    ? `${kindLabel(endpoint.kind)} ${PROTOCOL_LABELS[protocol]}`
    : kindLabel(endpoint.kind);
}

function handleKindChange(endpoint: EndpointForm, kind: string): void {
  endpoint.kind = kind;
  const protocols = freeProtocolsFor(kind, endpoint);
  if (!protocols.some((option) => option.value === endpoint.protocol)) {
    endpoint.protocol = protocols[0]?.value ?? "";
  }
}

function handleAdd(): void {
  const kind = addableKinds.value[0]?.value ?? "";
  endpoints.value.push({
    ...endpointFormFor(),
    kind,
    protocol: freeProtocolsFor(kind)[0]?.value ?? "",
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
        :options="kindOptionsFor(endpoint)"
        label="Endpoint Kind"
        placeholder="Pick a Kind"
        @update:model-value="handleKindChange(endpoint, $event)"
      />
      <AppSelect
        class="endpoint-list__protocol"
        v-model="endpoint.protocol"
        :options="freeProtocolsFor(endpoint.kind, endpoint)"
        :label="`${kindLabel(endpoint.kind)} Protocol`"
        placeholder="Pick a Protocol"
        empty-text="Every Protocol of this Kind has an endpoint"
      />
      <input
        v-model="endpoint.baseUrl"
        class="text-input endpoint-list__url"
        type="url"
        required
        :aria-label="`${endpointLabel(endpoint)} base URL`"
        placeholder="https://"
        :title="endpoint.baseUrl"
      />
      <button
        class="icon-button endpoint-list__remove"
        type="button"
        :aria-label="`Remove the ${endpointLabel(endpoint)} endpoint`"
        :disabled="endpoints.length === 1"
        @click="handleRemove(endpoint)"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <button
      v-if="addableKinds.length > 0"
      class="button endpoint-list__add"
      type="button"
      @click="handleAdd"
    >
      <Plus :size="14" /> Add endpoint
    </button>
  </fieldset>
</template>
