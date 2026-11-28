<script setup lang="ts">
import { Boxes, CloudOff } from '@lucide/vue';
import type { ModelChoice } from '~/lib/api-keys';
import {
  type IntegrationModel,
  type IntegrationSummary,
  integrationModelPriceLines,
} from '~/lib/integrations';
import { allowedGroupName } from '~/lib/modelGroups';
import { type ModelLabel, modelLabelOf } from '~/lib/routing';
import { CAPABILITY_LABELS, MODEL_KIND_LABELS } from '~/lib/upstream';

const props = defineProps<{
  integration: IntegrationSummary;
  modelChoices: ModelChoice[] | undefined;
}>();

const {
  data: modelList,
  error: loadError,
  status,
} = useDashboardApi<{ models: IntegrationModel[] }>(
  () => `/integrations/${props.integration.id}/models`,
  { watch: [() => props.integration.allowedModels, () => props.integration.allowedModelGroups] },
);

const isLoading = computed(() => status.value === 'pending' && !modelList.value);
const sellsEveryModel = computed(
  () =>
    props.integration.allowedModels.length === 0 &&
    props.integration.allowedModelGroups.length === 0,
);
const allowedGroupNames = computed(() =>
  props.integration.allowedModelGroups.map((group) => allowedGroupName(group)).join(', '),
);

const modelChoiceById = computed(
  () => new Map((props.modelChoices ?? []).map((model) => [model.id, model])),
);

function labelOf(model: IntegrationModel): ModelLabel {
  const current = modelChoiceById.value.get(model.id);
  return current ? modelLabelOf(current, model.name) : { label: model.name };
}

const rows = computed(() =>
  (modelList.value?.models ?? []).map((model) => ({
    model,
    label: labelOf(model),
    capabilities: model.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(', '),
    priceLines: integrationModelPriceLines(model),
  })),
);
</script>

<template>
  <section class="panel table-panel">
    <p v-if="sellsEveryModel && rows.length > 0" class="panel-note">
      No allowed Models or Groups are set, so it may sell every Model, including ones added later.
    </p>
    <p v-else-if="allowedGroupNames" class="panel-note">
      It may sell every Model currently in {{ allowedGroupNames }}.
    </p>
    <EmptyState v-if="loadError" :icon="CloudOff" tone="error">
      <strong>Couldn't load the Models.</strong
      ><span>Check that the backend is running, then reload the page.</span>
    </EmptyState>
    <div v-else-if="isLoading" class="loading-panel" aria-busy="true"><AppSpinner /></div>
    <EmptyState v-else-if="rows.length === 0" :icon="Boxes">
      <strong>No Models to sell.</strong
      ><span>{{
        sellsEveryModel
          ? 'The Catalog has no enabled Models yet.'
          : 'Its allowed Models and Groups were deleted, disabled or are empty.'
      }}</span>
    </EmptyState>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Capabilities</th>
            <th>Prices</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ model, label, capabilities, priceLines } in rows" :key="model.id">
            <td>
              <NuxtLink class="table-entity" :to="`/models/${model.id}`">
                <span class="key-icon"><Boxes :size="15" /></span>
                <span>
                  <strong>{{ label.label }}</strong>
                  <code v-if="label.note" class="cell-note">{{ label.note }}</code>
                </span>
              </NuxtLink>
            </td>
            <td>{{ MODEL_KIND_LABELS[model.kind] }}</td>
            <td>
              <template v-if="capabilities">{{ capabilities }}</template>
              <span v-else class="value-never">None</span>
            </td>
            <td>
              <template v-if="priceLines.length">
                <span v-for="line in priceLines" :key="line.label" class="price-line tabular"
                  >{{ line.label }} <strong>{{ line.value }}</strong></span
                >
              </template>
              <span v-else class="value-never">Not set</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
