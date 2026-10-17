<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  CircleDollarSign,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
} from "lucide-vue-next";
import { api } from "@/lib/api";
import { currency, number } from "@/lib/format";
import type { PricingMap } from "@/types/api";
import PageHeader from "@/components/app/PageHeader.vue";
import StatTile from "@/components/app/StatTile.vue";
import DataTable from "@/components/app/DataTable.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import Input from "@/components/ui/input.vue";
import Label from "@/components/ui/label.vue";
import { useNotificationStore } from "@/stores/notifications";
import Modal from "@/components/ui/modal.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";

const fields = [
  "input",
  "output",
  "cached",
  "reasoning",
  "cache_creation",
] as const;
const queryClient = useQueryClient();
const notices = useNotificationStore();
const pricing = useQuery({ queryKey: ["pricing"], queryFn: api.pricing.get });
const draft = reactive<PricingMap>({});
const newProvider = ref("");
const newModel = ref("");
const resetTarget = ref<{ provider: string; model: string } | null>(null);
const busy = ref(false);
const showAddEntry = ref(false);

function replaceDraft(value: PricingMap) {
  Object.keys(draft).forEach((provider) => delete draft[provider]);
  Object.assign(draft, structuredClone(value));
}

watch(
  () => pricing.data.value,
  (value) => {
    if (value) replaceDraft(value);
  },
  { immediate: true },
);

const rows = computed(() =>
  Object.entries(draft).flatMap(([provider, models]) =>
    Object.entries(models).map(([model, rates]) => ({
      provider,
      model,
      rates,
    })),
  ),
);
const providers = computed(
  () => new Set(rows.value.map((row) => row.provider)).size,
);
const configuredFields = computed(() =>
  rows.value.reduce((count, row) => count + Object.keys(row.rates).length, 0),
);

function rate(provider: string, model: string, field: (typeof fields)[number]) {
  return draft[provider]?.[model]?.[field] ?? "";
}

function updateRate(
  provider: string,
  model: string,
  field: (typeof fields)[number],
  event: Event,
) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!draft[provider]) draft[provider] = {};
  if (!draft[provider][model]) draft[provider][model] = {};
  if (Number.isFinite(value)) draft[provider][model][field] = value;
}

function addEntry() {
  const provider = newProvider.value.trim();
  const model = newModel.value.trim();
  if (!provider || !model) return;
  draft[provider] ||= {};
  draft[provider][model] ||= { input: 0, output: 0 };
  newProvider.value = "";
  newModel.value = "";
  showAddEntry.value = false;
}

async function save() {
  busy.value = true;
  try {
    const result = await api.pricing.update(draft);
    replaceDraft(result);
    await queryClient.invalidateQueries({ queryKey: ["pricing"] });
    notices.push("success", "Pricing overrides saved.");
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error
        ? error.message
        : "Could not save pricing overrides.",
    );
  } finally {
    busy.value = false;
  }
}

function requestReset(provider: string, model: string) {
  resetTarget.value = { provider, model };
}

async function resetOverride(provider: string, model: string) {
  busy.value = true;
  try {
    const result = await api.pricing.reset(provider, model);
    replaceDraft(result);
    await queryClient.invalidateQueries({ queryKey: ["pricing"] });
    notices.push(
      "success",
      `${provider}/${model} reset to its backend default.`,
    );
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not reset pricing.",
    );
  } finally {
    busy.value = false;
  }
}

async function confirmReset() {
  const target = resetTarget.value;
  if (!target) return;
  try {
    await resetOverride(target.provider, target.model);
  } finally {
    resetTarget.value = null;
  }
}

async function resetAll() {
  if (!window.confirm("Reset every custom pricing override?")) return;
  busy.value = true;
  try {
    const result = await api.pricing.reset();
    replaceDraft(result);
    await queryClient.invalidateQueries({ queryKey: ["pricing"] });
    notices.push("success", "All pricing overrides reset.");
  } catch (error) {
    notices.push(
      "error",
      error instanceof Error ? error.message : "Could not reset pricing.",
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="theme-v2 space-y-6">
    <PageHeader
      title="Pricing settings"
      description="Edit the model rate card used by v2 cost accounting. Values are USD per million tokens."
      ><template #actions
        ><Button
          variant="outline"
          :disabled="pricing.isFetching.value || busy"
          @click="pricing.refetch()"
          ><RefreshCw
            :class="['size-4', pricing.isFetching.value && 'animate-spin']"
          />Refresh</Button
        ><Button :disabled="busy || !rows.length" @click="save"
          ><Save class="size-4" />{{
            busy ? "Saving..." : "Save changes"
          }}</Button
        ></template
      ></PageHeader
    >
    <div
      v-if="pricing.isError.value"
      role="alert"
      class="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
    >
      <ShieldAlert class="mt-0.5 size-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="font-medium">Pricing data could not be loaded.</p>
        <p class="mt-1 text-destructive/80">
          {{
            pricing.error.value instanceof Error
              ? pricing.error.value.message
              : "The v2 pricing endpoint returned an error."
          }}
        </p>
      </div>
      <Button variant="outline" @click="pricing.refetch()">Try again</Button>
    </div>
    <div class="grid gap-3 sm:grid-cols-3">
      <StatTile
        label="Rate entries"
        :value="pricing.isPending.value ? '...' : number(rows.length)"
        detail="Provider and model combinations"
      /><StatTile
        label="Providers"
        :value="pricing.isPending.value ? '...' : number(providers)"
        detail="Namespaces in the rate card"
      /><StatTile
        label="Rate fields"
        :value="pricing.isPending.value ? '...' : number(configuredFields)"
        detail="Input, output, cache, and reasoning"
        tone="success"
      />
    </div>

    <Button @click="showAddEntry = true"
      ><Plus class="size-4" />Add rate entry</Button
    ><Modal
      :open="showAddEntry"
      title="Add pricing entry"
      @close="showAddEntry = false"
      ><div class="space-y-4">
        <div class="space-y-2">
          <Label for="pricing-provider">Provider</Label
          ><Input
            id="pricing-provider"
            v-model="newProvider"
            placeholder="openai"
          />
        </div>
        <div class="space-y-2">
          <Label for="pricing-model">Model</Label
          ><Input id="pricing-model" v-model="newModel" placeholder="gpt-4.1" />
        </div>
        <Button
          :disabled="!newProvider.trim() || !newModel.trim()"
          @click="addEntry"
          ><Plus class="size-4" />Add rate entry</Button
        >
      </div></Modal
    >

    <EmptyState
      v-if="!pricing.isPending.value && !pricing.isError.value && !rows.length"
      title="No pricing entries"
      description="Add a provider and model to create the first rate entry."
    />
    <DataTable
      v-else
      :loading="pricing.isPending.value"
      :empty="!rows.length"
      :columns="[
        'Provider / model',
        'Input',
        'Output',
        'Cached',
        'Reasoning',
        'Cache creation',
        'Actions',
      ]"
      empty-title="No pricing entries"
      empty-description="Add a provider and model to create the first rate entry."
      ><tr
        v-for="row in rows"
        :key="`${row.provider}/${row.model}`"
        class="align-top transition-colors hover:bg-muted/35"
      >
        <td class="px-3.75 py-2.25">
          <p class="font-medium">{{ row.provider }}</p>
          <p class="mt-1 font-mono text-xs text-muted-foreground">
            {{ row.model }}
          </p>
        </td>
        <td v-for="field in fields" :key="field" class="w-28 px-2 py-2.25">
          <label
            class="sr-only"
            :for="`pricing-${row.provider}-${row.model}-${field}`"
            >{{ field }} rate</label
          ><input
            :id="`pricing-${row.provider}-${row.model}-${field}`"
            type="number"
            min="0"
            step="any"
            :value="rate(row.provider, row.model, field)"
            class="h-8 w-full rounded-md border border-input bg-background px-2 text-right text-xs tabular-nums outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            @input="updateRate(row.provider, row.model, field, $event)"
          />
        </td>
        <td class="whitespace-nowrap px-2.25 py-2.25">
          <Button
            variant="ghost"
            size="icon"
            :disabled="busy"
            :aria-label="`Reset ${row.provider}/${row.model}`"
            title="Reset to default"
            @click="requestReset(row.provider, row.model)"
            ><RotateCcw class="size-3.5"
          /></Button>
        </td></tr
    ></DataTable>
    <Card class="flex items-start gap-3 border-primary/15 bg-accent/45 p-5"
      ><CircleDollarSign class="mt-0.5 size-4 shrink-0 text-primary" />
      <div>
        <h3 class="text-sm font-semibold">Accounting context</h3>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">
          The backend merges these persisted overrides with its default rate
          card. Resetting a row removes the override and reveals that default
          again. Recorded usage totals remain on the Usage page.
        </p>
        <Button
          variant="link"
          class="mt-2 px-0"
          :disabled="busy"
          @click="resetAll"
          >Reset all overrides</Button
        >
      </div></Card
    >
    <ConfirmModal
      :open="Boolean(resetTarget)"
      title="Reset pricing override"
      :message="`Reset ${resetTarget?.provider || ''}/${resetTarget?.model || ''} to its backend default?`"
      confirm-text="Reset"
      :loading="busy"
      @confirm="confirmReset"
      @close="!busy && (resetTarget = null)"
    />
  </div>
</template>
