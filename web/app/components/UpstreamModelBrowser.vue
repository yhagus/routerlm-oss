<script setup lang="ts">
import {
  ArrowDownUp,
  ArrowUpRight,
  Braces,
  Brain,
  Eye,
  Layers,
  Pencil,
  Plus,
  Power,
  Trash2,
  Wrench,
} from "@lucide/vue";
import type { Component, WritableComputedRef } from "vue";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  type Capability,
  numberField,
  optionalNumber,
  type Provider,
  type TierPrices,
  type UpstreamModel,
  upstreamModelLabel,
} from "~/lib/upstream";
import { type ActiveFilter, listFilterTokens } from "~/lib/activeFilters";
import { actionsColumn, type DataTableColumn } from "~/lib/dataTable";
import { formatNumberInput } from "~/lib/numberInput";
import { SERVICE_TIER_LABELS, SERVICE_TIERS, type ServiceTier } from "~/lib/parameterPolicy";

/**
 * Upstream Models with filters, sorting and editing. With `provider` it shows
 * only that Provider's models and drops the Provider filter and column note.
 */
const props = defineProps<{
  providers: Provider[];
  upstreamModels: UpstreamModel[];
  refresh: () => Promise<unknown>;
  provider?: Provider;
  /** The models haven't arrived yet: placeholder rows instead of the empty state. */
  isLoading?: boolean;
  /** A failed load; the table shows it with Retry, which calls `refresh`. */
  error?: unknown;
}>();

type UpstreamModelDialog =
  | { kind: "details"; upstreamModel: UpstreamModel }
  | { kind: "create" }
  | { kind: "edit"; upstreamModel: UpstreamModel }
  | { kind: "delete"; upstreamModel: UpstreamModel };

const CAPABILITY_ICONS: Record<Capability, Component> = {
  vision: Eye,
  tools: Wrench,
  reasoning: Brain,
  "structured-output": Braces,
};

const { $dashboardApi } = useNuxtApp();

const providerById = computed(
  () => new Map(props.providers.map((provider) => [provider.id, provider])),
);
const providerOptions = computed(() =>
  props.providers.map((provider) => ({
    label: provider.name,
    value: provider.id,
  })),
);

const scopedModels = computed(() =>
  props.provider
    ? props.upstreamModels.filter((model) => model.providerId === props.provider?.id)
    : props.upstreamModels,
);

const CONTEXT_MINIMUMS = ["", "32000", "128000", "200000", "256000", "1000000"] as const;
const RELEASE_WINDOWS = ["", "30", "90", "180", "365"] as const;
const SORT_ORDERS = [
  "newest",
  "oldest",
  "name",
  "provider",
  "input-asc",
  "input-desc",
  "output-asc",
  "context-desc",
] as const;

const MODEL_STATUSES = ["enabled", "disabled"] as const;

// Held in the URL (?provider=anthropic,openai&context=128000&released=90&capability=vision,tools&status=…&sort=…)
// so a refresh or a link keeps them. A Provider is its slug, readable and stable. The
// DataTable holds the search and page the same way.
const providerSlugs = computed(() => props.providers.map((each) => each.slug));
const providerFilter = useQueryList("provider", {
  isValid: anyText,
  order: providerSlugs,
});
const contextFilter = useQueryParam("context", {
  default: "",
  isValid: oneOf(CONTEXT_MINIMUMS),
});
const releasedFilter = useQueryParam("released", {
  default: "",
  isValid: oneOf(RELEASE_WINDOWS),
});
const capabilityFilter = useQueryList("capability", {
  isValid: oneOf(CAPABILITIES),
  order: CAPABILITIES,
});
const statusFilter = useQueryList("status", {
  isValid: oneOf(MODEL_STATUSES),
  order: MODEL_STATUSES,
});
const sortOrder = useQueryParam("sort", {
  default: "newest",
  isValid: oneOf(SORT_ORDERS),
});

const providerBySlug = computed(() => new Map(props.providers.map((each) => [each.slug, each])));
const providerFilterOptions = computed(() => [
  ...props.providers.map((each) => ({ label: each.name, value: each.slug })),
  // A link can name a Provider since deleted: show it so it can be unchecked.
  ...providerFilter.value
    .filter((slug) => !providerBySlug.value.has(slug))
    .map((slug) => ({ label: `${slug} (not found)`, value: slug })),
]);
/** Smallest context window a model must have. */
const contextFilterOptions = [
  { label: "Any context", value: "" },
  { label: "32K+ context", value: "32000" },
  { label: "128K+ context", value: "128000" },
  { label: "200K+ context", value: "200000" },
  { label: "256K+ context", value: "256000" },
  { label: "1M+ context", value: "1000000" },
];
/** How recently a model must have been released, in days. */
const releasedFilterOptions = [
  { label: "Any release date", value: "" },
  { label: "Released in 30 days", value: "30" },
  { label: "Released in 90 days", value: "90" },
  { label: "Released in 6 months", value: "180" },
  { label: "Released in 1 year", value: "365" },
];
const capabilityFilterOptions = CAPABILITIES.map((capability) => ({
  label: CAPABILITY_LABELS[capability],
  value: capability,
}));
const statusFilterOptions = [
  { label: "Enabled", value: "enabled" },
  { label: "Disabled", value: "disabled" },
] satisfies { label: string; value: (typeof MODEL_STATUSES)[number] }[];
const sortOptions = computed(() => [
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
  { label: "Name", value: "name" },
  ...(props.provider ? [] : [{ label: "Provider", value: "provider" }]),
  { label: "Input price, lowest", value: "input-asc" },
  { label: "Input price, highest", value: "input-desc" },
  { label: "Output price, lowest", value: "output-asc" },
  { label: "Context, largest", value: "context-desc" },
]);

function providerName(model: UpstreamModel): string {
  return providerById.value.get(model.providerId)?.name ?? "—";
}

/** Compares two optional prices; models without a price always sort last. */
function comparePrices(first: number | null, second: number | null, direction: 1 | -1): number {
  if (first === null || second === null)
    return (first === null ? 1 : 0) - (second === null ? 1 : 0);
  return (first - second) * direction;
}

/** Compares two optional Release Dates; models without one always sort last. */
function compareReleaseDates(
  first: string | null,
  second: string | null,
  direction: 1 | -1,
): number {
  if (first === null || second === null)
    return (first === null ? 1 : 0) - (second === null ? 1 : 0);
  // "YYYY-MM-DD" strings order the same as the dates they name.
  return first.localeCompare(second) * direction;
}

/** The "YYYY-MM-DD" day a given number of days before today, in UTC. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function compareModels(first: UpstreamModel, second: UpstreamModel): number {
  const byName = (first.name ?? first.upstreamModelId).localeCompare(
    second.name ?? second.upstreamModelId,
  );
  switch (sortOrder.value) {
    case "newest":
      return compareReleaseDates(first.releaseDate, second.releaseDate, -1) || byName;
    case "oldest":
      return compareReleaseDates(first.releaseDate, second.releaseDate, 1) || byName;
    case "provider":
      return providerName(first).localeCompare(providerName(second)) || byName;
    case "input-asc":
      return comparePrices(first.inputPrice, second.inputPrice, 1) || byName;
    case "input-desc":
      return comparePrices(first.inputPrice, second.inputPrice, -1) || byName;
    case "output-asc":
      return comparePrices(first.outputPrice, second.outputPrice, 1) || byName;
    case "context-desc":
      return second.contextSize - first.contextSize || byName;
    default:
      return byName;
  }
}

/** Models the filters keep, in the picked order; the DataTable applies the search. */
const visibleModels = computed(() => {
  const minContext = Number(contextFilter.value || 0);
  const releasedSince = releasedFilter.value ? daysAgo(Number(releasedFilter.value)) : null;
  return scopedModels.value
    .filter((model) => {
      const slug = providerById.value.get(model.providerId)?.slug ?? "";
      if (providerFilter.value.length && !providerFilter.value.includes(slug)) return false;
      if (model.contextSize < minContext) return false;
      // A model without a Release Date can't be shown to fall inside the window.
      if (releasedSince !== null && (model.releaseDate ?? "") < releasedSince) return false;
      // A model must have every picked capability.
      if (!capabilityFilter.value.every((capability) => model.capabilities.includes(capability))) {
        return false;
      }
      const status = model.isEnabled ? "enabled" : "disabled";
      return statusFilter.value.length === 0 || statusFilter.value.includes(status);
    })
    .toSorted(compareModels);
});

/** The picked option of a one-value filter as a token, or none while it is at "" (any). */
function selectFilterTokens(
  group: string,
  selected: WritableComputedRef<string>,
  options: { label: string; value: string }[],
): ActiveFilter[] {
  if (!selected.value) return [];
  return [
    {
      key: group,
      group,
      label: options.find((option) => option.value === selected.value)?.label ?? selected.value,
      remove: () => {
        selected.value = "";
      },
    },
  ];
}

const activeFilters = computed<ActiveFilter[]>(() => [
  ...listFilterTokens("Provider", providerFilter, providerFilterOptions.value),
  ...selectFilterTokens("Context", contextFilter, contextFilterOptions),
  ...selectFilterTokens("Released", releasedFilter, releasedFilterOptions),
  ...listFilterTokens("Capability", capabilityFilter, capabilityFilterOptions),
  ...listFilterTokens("Status", statusFilter, statusFilterOptions),
]);

function clearFilters(): void {
  providerFilter.value = [];
  contextFilter.value = "";
  releasedFilter.value = "";
  capabilityFilter.value = [];
  statusFilter.value = [];
}

const columns: DataTableColumn<UpstreamModel>[] = [
  {
    id: "upstreamModel",
    header: "Upstream Model",
    enableHiding: false,
    // What the search matches: the model's id, its name, or its Provider's name.
    accessorFn: (model) =>
      [model.upstreamModelId, model.name ?? "", providerName(model)].join("\n"),
  },
  { id: "capabilities", header: "Capabilities" },
  { id: "context", header: "Context" },
  { id: "maxOutput", header: "Max output" },
  { id: "inputPrice", header: "Input $/M" },
  { id: "outputPrice", header: "Output $/M" },
  { id: "released", header: "Released" },
  { id: "status", header: "Status" },
  actionsColumn(),
];

const NUMERIC_COLUMNS = new Set(["context", "maxOutput", "inputPrice", "outputPrice", "released"]);
/** Columns faded in a disabled model's row, found by id so hiding a column doesn't shift them. */
const FADED_WHEN_OFF_COLUMNS = new Set([
  "capabilities",
  "context",
  "maxOutput",
  "inputPrice",
  "outputPrice",
]);

function columnClass(columnId: string): Record<string, boolean> {
  return {
    "model-table__num tabular": NUMERIC_COLUMNS.has(columnId),
    "model-table__center": columnId === "status",
    "model-table__fades": FADED_WHEN_OFF_COLUMNS.has(columnId),
  };
}

/** Token counts in full with digit grouping, "1,048,576". */
const tokenFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
/** The short form, "1M", beside the full count in the details dialog. */
const compactTokenFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const priceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});
function formatPrice(price: number | null): string {
  return price === null ? "—" : priceFormat.format(price);
}

const shareFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** A cache price as a share of its group's price, "2.5% of input"; empty without both. */
function shareOf(price: number | null, base: number | null, baseName: string): string {
  if (price === null || base === null || base === 0) return "";
  return `${shareFormat.format(price / base)} of ${baseName}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function capabilitySummary(model: UpstreamModel): string {
  const names = CAPABILITIES.filter((capability) => model.capabilities.includes(capability)).map(
    (capability) => CAPABILITY_LABELS[capability],
  );
  return names.length ? `Capabilities: ${names.join(", ")}` : "No listed capabilities";
}

const {
  dialog,
  isDialogOpen,
  isSaving,
  dialogError,
  showDialog,
  closeDialog,
  submitDialog,
  deleteRow,
  toggleRow,
} = useEditableList<UpstreamModelDialog>("/upstream-models", props.refresh);

/** Number inputs hold a number, or "" when empty. */
type NumberInput = number | string;

interface UpstreamModelForm {
  providerId: string;
  upstreamModelId: string;
  /** The display name, or "" when it has none. */
  name: string;
  capabilities: Capability[];
  contextSize: NumberInput;
  maxOutputTokens: NumberInput;
  inputPrice: NumberInput;
  outputPrice: NumberInput;
  cacheReadPrice: NumberInput;
  cacheWritePrice: NumberInput;
  /** "YYYY-MM-DD" from the date input, or "" when empty. */
  releaseDate: string;
  serviceTiers: ServiceTier[];
  /** Each accepted tier's prices; an empty field means the standard price. */
  tierPrices: Record<ServiceTier, TierPriceFields>;
}

type TierPriceFields = Record<keyof Required<TierPrices>, NumberInput>;

const TIER_PRICE_FIELDS = [
  { key: "inputPrice", label: "Input" },
  { key: "outputPrice", label: "Output" },
  { key: "cacheReadPrice", label: "Cache read" },
  { key: "cacheWritePrice", label: "Cache write" },
] as const satisfies { key: keyof TierPrices; label: string }[];

function tierPriceFields(prices: TierPrices | undefined): TierPriceFields {
  return {
    inputPrice: prices?.inputPrice ?? "",
    outputPrice: prices?.outputPrice ?? "",
    cacheReadPrice: prices?.cacheReadPrice ?? "",
    cacheWritePrice: prices?.cacheWritePrice ?? "",
  };
}

/** Prices for the accepted tiers only, each with just the prices typed in. */
function tierPricesFromForm(form: UpstreamModelForm): Partial<Record<ServiceTier, TierPrices>> {
  const tierPrices: Partial<Record<ServiceTier, TierPrices>> = {};
  for (const tier of form.serviceTiers) {
    const prices: TierPrices = {};
    for (const { key } of TIER_PRICE_FIELDS) {
      const price = optionalNumber(form.tierPrices[tier][key]);
      if (price !== null) prices[key] = price;
    }
    if (Object.keys(prices).length > 0) tierPrices[tier] = prices;
  }
  return tierPrices;
}

const form = ref<UpstreamModelForm>(emptyForm());

function emptyForm(): UpstreamModelForm {
  return {
    providerId:
      props.provider?.id ||
      // With one Provider filtered, a new model most likely belongs to it.
      (providerFilter.value.length === 1
        ? providerBySlug.value.get(providerFilter.value[0] ?? "")?.id
        : undefined) ||
      (providerOptions.value[0]?.value ?? ""),
    upstreamModelId: "",
    name: "",
    capabilities: [],
    contextSize: "",
    maxOutputTokens: "",
    inputPrice: "",
    outputPrice: "",
    cacheReadPrice: "",
    cacheWritePrice: "",
    releaseDate: "",
    serviceTiers: [],
    tierPrices: { fast: tierPriceFields(undefined), flex: tierPriceFields(undefined) },
  };
}

function formFor(upstreamModel: UpstreamModel): UpstreamModelForm {
  return {
    providerId: upstreamModel.providerId,
    upstreamModelId: upstreamModel.upstreamModelId,
    name: upstreamModel.name ?? "",
    capabilities: [...upstreamModel.capabilities],
    contextSize: upstreamModel.contextSize,
    maxOutputTokens: numberField(upstreamModel.maxOutputTokens),
    inputPrice: numberField(upstreamModel.inputPrice),
    outputPrice: numberField(upstreamModel.outputPrice),
    cacheReadPrice: numberField(upstreamModel.cacheReadPrice),
    cacheWritePrice: numberField(upstreamModel.cacheWritePrice),
    releaseDate: upstreamModel.releaseDate ?? "",
    serviceTiers: SERVICE_TIERS.filter((tier) => upstreamModel.serviceTiers.includes(tier)),
    tierPrices: {
      fast: tierPriceFields(upstreamModel.tierPrices.fast),
      flex: tierPriceFields(upstreamModel.tierPrices.flex),
    },
  };
}

function openDialog(next: UpstreamModelDialog): void {
  showDialog(next);
  if (next.kind === "create") form.value = emptyForm();
  if (next.kind === "edit") form.value = formFor(next.upstreamModel);
}

async function saveUpstreamModel(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === "delete") return;
  const fields = {
    upstreamModelId: form.value.upstreamModelId,
    name: form.value.name.trim() || null,
    capabilities: form.value.capabilities,
    contextSize: optionalNumber(form.value.contextSize),
    maxOutputTokens: optionalNumber(form.value.maxOutputTokens),
    inputPrice: optionalNumber(form.value.inputPrice),
    outputPrice: optionalNumber(form.value.outputPrice),
    cacheReadPrice: optionalNumber(form.value.cacheReadPrice),
    cacheWritePrice: optionalNumber(form.value.cacheWritePrice),
    releaseDate: form.value.releaseDate || null,
    serviceTiers: SERVICE_TIERS.filter((tier) => form.value.serviceTiers.includes(tier)),
    tierPrices: tierPricesFromForm(form.value),
  };
  const failureMessage = "Couldn't save the Upstream Model.";
  if (current.kind === "create") {
    await submitDialog(
      () =>
        $dashboardApi("/upstream-models", {
          method: "POST",
          body: { providerId: form.value.providerId, ...fields },
        }),
      `Added ${upstreamModelLabel(fields)}`,
      failureMessage,
    );
    return;
  }
  await submitDialog(
    () =>
      $dashboardApi(`/upstream-models/${current.upstreamModel.id}`, {
        method: "PATCH",
        body: fields,
      }),
    `Saved ${upstreamModelLabel(fields)}`,
    failureMessage,
  );
}

function deleteUpstreamModel(upstreamModel: UpstreamModel): Promise<void> {
  return deleteRow(
    upstreamModel,
    upstreamModelLabel(upstreamModel),
    "Couldn't delete the Upstream Model.",
  );
}

function toggleUpstreamModel(upstreamModel: UpstreamModel): Promise<void> {
  return toggleRow(upstreamModel, upstreamModelLabel(upstreamModel));
}

/** The model the details dialog shows, read fresh from the list so a toggle shows at once. */
const detailsModel = computed(() => {
  const current = dialog.value;
  if (current?.kind !== "details") return undefined;
  return props.upstreamModels.find((model) => model.id === current.upstreamModel.id);
});
const isDetailsOpen = computed({
  get: () => detailsModel.value !== undefined,
  set: (open) => {
    if (!open) closeDialog();
  },
});

defineExpose({ openCreate: () => openDialog({ kind: "create" }) });
</script>

<template>
  <DataTable
    class="model-table"
    :table-id="provider ? 'provider-upstream-models' : 'upstream-models'"
    label="Upstream Models"
    :search-placeholder="provider ? 'Search models' : 'Search models or Providers'"
    :columns="columns"
    :rows="visibleModels"
    :get-row-id="(model) => model.id"
    :row-class="(model) => ({ 'model-table__row--off': !model.isEnabled })"
    :column-class="columnClass"
    :is-loading="isLoading"
    :error="error"
    :refresh="refresh"
    :filters="activeFilters"
    @clear-filters="clearFilters"
  >
    <template #controls>
      <AppSelect v-model="sortOrder" :options="sortOptions" label="Sort by" class="model-sort">
        <template #leading><ArrowDownUp :size="13" class="model-sort__icon" /></template>
      </AppSelect>
      <slot name="actions" :open-create="() => openDialog({ kind: 'create' })" />
    </template>
    <template #filters>
      <div v-if="!provider" class="data-table-filter">
        <span class="data-table-filter__label" aria-hidden="true">Provider</span>
        <AppMultiSelect
          v-model="providerFilter"
          :options="providerFilterOptions"
          label="Filter by Provider"
          placeholder="All Providers"
          noun="Providers"
        />
      </div>
      <div class="data-table-filter">
        <span class="data-table-filter__label" aria-hidden="true">Context</span>
        <AppSelect
          v-model="contextFilter"
          :options="contextFilterOptions"
          label="Minimum context"
        />
      </div>
      <div class="data-table-filter">
        <span class="data-table-filter__label" aria-hidden="true">Released</span>
        <AppSelect v-model="releasedFilter" :options="releasedFilterOptions" label="Release date" />
      </div>
      <div class="data-table-filter">
        <span class="data-table-filter__label" aria-hidden="true">Capability</span>
        <AppMultiSelect
          v-model="capabilityFilter"
          :options="capabilityFilterOptions"
          label="Filter by capability"
          placeholder="Any capability"
          noun="capabilities"
          match="all"
        />
      </div>
      <div class="data-table-filter">
        <span class="data-table-filter__label" aria-hidden="true">Status</span>
        <AppMultiSelect
          v-model="statusFilter"
          :options="statusFilterOptions"
          label="Filter by status"
          placeholder="Any status"
          noun="statuses"
        />
      </div>
    </template>
    <template #cell-upstreamModel="{ row: model }">
      <div class="table-entity model-table__entity">
        <ProviderLogo
          v-if="!provider && providerById.get(model.providerId)"
          :logo="providerById.get(model.providerId)?.logo ?? null"
          :name="providerName(model)"
          :base-url="providerById.get(model.providerId)?.baseUrl ?? ''"
        />
        <span class="model-table__name">
          <button
            class="model-table__open"
            type="button"
            :title="upstreamModelLabel(model)"
            @click="openDialog({ kind: 'details', upstreamModel: model })"
          >
            {{ model.name ?? model.upstreamModelId }}
          </button>
          <span v-if="model.name !== null" class="cell-note model-table__id">{{
            model.upstreamModelId
          }}</span>
          <NuxtLink
            v-if="!provider"
            class="cell-note"
            :to="`/providers/${model.providerId}?tab=models`"
            >{{ providerName(model) }}</NuxtLink
          >
        </span>
      </div>
    </template>
    <template #cell-capabilities="{ row: model }">
      <span class="capability-icons" role="img" :aria-label="capabilitySummary(model)">
        <span
          v-for="capability in CAPABILITIES"
          :key="capability"
          class="capability-icons__item"
          :class="{
            'capability-icons__item--on': model.capabilities.includes(capability),
          }"
          :title="
            model.capabilities.includes(capability)
              ? CAPABILITY_LABELS[capability]
              : `No ${CAPABILITY_LABELS[capability].toLowerCase()}`
          "
          ><component :is="CAPABILITY_ICONS[capability]" :size="14" aria-hidden="true"
        /></span>
      </span>
    </template>
    <template #cell-context="{ row: model }">
      {{ tokenFormat.format(model.contextSize) }}
    </template>
    <template #cell-maxOutput="{ row: model }">
      {{ model.maxOutputTokens === null ? "—" : tokenFormat.format(model.maxOutputTokens) }}
    </template>
    <template #cell-inputPrice="{ row: model }">
      <strong>{{ formatPrice(model.inputPrice) }}</strong>
      <span v-if="model.cacheReadPrice !== null" class="cell-note" title="Cache read">{{
        formatPrice(model.cacheReadPrice)
      }}</span>
    </template>
    <template #cell-outputPrice="{ row: model }">
      <strong>{{ formatPrice(model.outputPrice) }}</strong>
      <span v-if="model.cacheWritePrice !== null" class="cell-note" title="Cache write">{{
        formatPrice(model.cacheWritePrice)
      }}</span>
    </template>
    <template #cell-released="{ row: model }">{{ model.releaseDate ?? "—" }}</template>
    <template #cell-status="{ row: model }">
      <span
        class="status-badge"
        :class="model.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
        >{{ model.isEnabled ? "Enabled" : "Disabled" }}</span
      >
    </template>
    <template #cell-actions="{ row: model }">
      <div class="row-actions provider-table__actions">
        <button
          class="icon-action"
          type="button"
          :aria-label="`Edit ${upstreamModelLabel(model)}`"
          title="Edit"
          @click="openDialog({ kind: 'edit', upstreamModel: model })"
        >
          <Pencil :size="14" />
        </button>
        <button
          class="icon-action"
          type="button"
          :aria-label="`${model.isEnabled ? 'Disable' : 'Enable'} ${upstreamModelLabel(model)}`"
          :title="model.isEnabled ? 'Disable' : 'Enable'"
          @click="toggleUpstreamModel(model)"
        >
          <Power :size="14" />
        </button>
        <button
          class="icon-action icon-action--danger"
          type="button"
          :aria-label="`Delete ${upstreamModelLabel(model)}`"
          title="Delete"
          @click="openDialog({ kind: 'delete', upstreamModel: model })"
        >
          <Trash2 :size="14" />
        </button>
      </div>
    </template>
    <template #empty>
      <EmptyState :icon="Layers">
        <strong>No Upstream Models here yet.</strong>
        <span v-if="providers.length"
          >Add one, or run <code>bun run db:seed</code> to load the Catalog.</span
        >
        <span v-else>Add a Provider first, then its models.</span>
        <button
          v-if="providers.length"
          class="text-button"
          type="button"
          @click="openDialog({ kind: 'create' })"
        >
          <Plus :size="13" /> Add Upstream Model
        </button>
      </EmptyState>
    </template>
  </DataTable>

  <AppDialog
    v-if="detailsModel"
    v-model:open="isDetailsOpen"
    wide
    :title="detailsModel.name ?? detailsModel.upstreamModelId"
    :description="`${detailsModel.name === null ? 'Upstream Model' : detailsModel.upstreamModelId} at ${providerName(detailsModel)}. Prices are per million tokens.`"
  >
    <div class="model-details">
      <div class="model-details__status">
        <span
          class="status-badge"
          :class="detailsModel.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
          >{{ detailsModel.isEnabled ? "Enabled" : "Disabled" }}</span
        >
        <NuxtLink
          v-if="!provider"
          class="model-details__provider"
          :to="`/providers/${detailsModel.providerId}?tab=models`"
          @click="closeDialog"
          >{{ providerName(detailsModel) }} <ArrowUpRight :size="12"
        /></NuxtLink>
      </div>

      <section class="model-details__section" aria-label="Capabilities">
        <h3>Capabilities</h3>
        <ul class="model-details__capabilities">
          <li
            v-for="capability in CAPABILITIES"
            :key="capability"
            :class="{ 'is-on': detailsModel.capabilities.includes(capability) }"
          >
            <component :is="CAPABILITY_ICONS[capability]" :size="14" aria-hidden="true" />
            {{ CAPABILITY_LABELS[capability] }}
            <span class="sr-only">{{
              detailsModel.capabilities.includes(capability) ? "supported" : "not supported"
            }}</span>
          </li>
        </ul>
      </section>

      <div class="model-details__grid">
        <section class="model-details__section">
          <h3>Limits</h3>
          <dl class="model-details__list">
            <div>
              <dt>Context window</dt>
              <dd class="tabular">
                {{ formatNumberInput(String(detailsModel.contextSize)) }}
                <span>{{ compactTokenFormat.format(detailsModel.contextSize) }} tokens</span>
              </dd>
            </div>
            <div>
              <dt>Max output</dt>
              <dd class="tabular">
                <template v-if="detailsModel.maxOutputTokens !== null">
                  {{ formatNumberInput(String(detailsModel.maxOutputTokens)) }}
                  <span>{{ compactTokenFormat.format(detailsModel.maxOutputTokens) }} tokens</span>
                </template>
                <template v-else>Not published</template>
              </dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd class="tabular">
                {{ detailsModel.releaseDate ?? "Unknown" }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="model-details__section">
          <h3>Pricing <span>USD / 1M tokens</span></h3>
          <dl class="model-details__list">
            <div>
              <dt>Input</dt>
              <dd class="tabular">
                {{ formatPrice(detailsModel.inputPrice) }}
              </dd>
            </div>
            <div>
              <dt>Cache read</dt>
              <dd class="tabular">
                {{ formatPrice(detailsModel.cacheReadPrice) }}
                <span
                  v-if="shareOf(detailsModel.cacheReadPrice, detailsModel.inputPrice, 'input')"
                  >{{
                    shareOf(detailsModel.cacheReadPrice, detailsModel.inputPrice, "input")
                  }}</span
                >
              </dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd class="tabular">
                {{ formatPrice(detailsModel.outputPrice) }}
              </dd>
            </div>
            <div>
              <dt>Cache write</dt>
              <dd class="tabular">
                {{ formatPrice(detailsModel.cacheWritePrice) }}
                <span
                  v-if="shareOf(detailsModel.cacheWritePrice, detailsModel.outputPrice, 'output')"
                  >{{
                    shareOf(detailsModel.cacheWritePrice, detailsModel.outputPrice, "output")
                  }}</span
                >
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <p class="model-details__meta tabular">
        Added {{ dateFormat.format(new Date(detailsModel.createdAt)) }} · Updated
        {{ dateFormat.format(new Date(detailsModel.updatedAt)) }}
      </p>
    </div>
    <div class="dialog__actions">
      <button class="button" type="button" @click="toggleUpstreamModel(detailsModel)">
        <Power :size="14" /> {{ detailsModel.isEnabled ? "Disable" : "Enable" }}
      </button>
      <button
        class="button button--primary"
        type="button"
        @click="openDialog({ kind: 'edit', upstreamModel: detailsModel })"
      >
        <Pencil :size="14" /> Edit
      </button>
    </div>
  </AppDialog>

  <AppDialog
    v-if="dialog?.kind === 'create' || dialog?.kind === 'edit'"
    v-model:open="isDialogOpen"
    wide
    :title="
      dialog.kind === 'create'
        ? 'Add Upstream Model'
        : `Edit ${upstreamModelLabel(dialog.upstreamModel)}`
    "
    description="Leave a price empty when the Provider doesn't publish it; Cost then stays empty."
  >
    <form class="form" @submit.prevent="saveUpstreamModel">
      <div class="form__grid">
        <div class="field">
          <span class="field__label">Provider</span>
          <AppSelect
            v-if="dialog.kind === 'create' && !provider"
            v-model="form.providerId"
            :options="providerOptions"
            label="Provider"
          />
          <input
            v-else
            class="text-input"
            :value="providerById.get(form.providerId)?.name"
            disabled
          />
        </div>
        <label class="field"
          ><span class="field__label">Name at the Provider</span
          ><input v-model="form.upstreamModelId" class="text-input" required
        /></label>
        <label class="field"
          ><span class="field__label">Display name (optional)</span
          ><input v-model="form.name" class="text-input" placeholder="e.g. K2.8 Preview"
        /></label>
      </div>
      <fieldset class="check-group">
        <legend class="field__label">Capabilities</legend>
        <label v-for="capability in CAPABILITIES" :key="capability" class="check-field"
          ><input v-model="form.capabilities" type="checkbox" :value="capability" />
          {{ CAPABILITY_LABELS[capability] }}</label
        >
      </fieldset>
      <div class="form__grid">
        <label class="field"
          ><span class="field__label">Context size (tokens)</span
          ><NumberInput
            v-model="form.contextSize"
            class="text-input"
            whole
            tokens
            :min="1"
            placeholder="e.g. 128k or 1m"
            required
        /></label>
        <label class="field"
          ><span class="field__label">Max output (tokens)</span
          ><NumberInput
            v-model="form.maxOutputTokens"
            class="text-input"
            whole
            tokens
            :min="1"
            placeholder="e.g. 64k"
        /></label>
        <label class="field"
          ><span class="field__label">Input price</span
          ><NumberInput
            v-model="form.inputPrice"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
        <label class="field"
          ><span class="field__label">Output price</span
          ><NumberInput
            v-model="form.outputPrice"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
        <label class="field"
          ><span class="field__label">Cache read price</span
          ><NumberInput
            v-model="form.cacheReadPrice"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
        <label class="field"
          ><span class="field__label">Cache write price</span
          ><NumberInput
            v-model="form.cacheWritePrice"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
        <div class="field">
          <span class="field__label">Release date</span>
          <AppDateInput v-model="form.releaseDate" label="Release date" />
        </div>
      </div>
      <fieldset class="check-group">
        <legend class="field__label">Service Tiers</legend>
        <label v-for="tier in SERVICE_TIERS" :key="tier" class="check-field"
          ><input v-model="form.serviceTiers" type="checkbox" :value="tier" />
          {{ SERVICE_TIER_LABELS[tier] }}</label
        >
      </fieldset>
      <p class="form__hint">
        A requested tier the model doesn't accept is dropped. A tier price left empty is the
        standard price.
      </p>
      <div v-for="tier in form.serviceTiers" :key="tier" class="form__grid">
        <label v-for="{ key, label } in TIER_PRICE_FIELDS" :key="key" class="field"
          ><span class="field__label"
            >{{ SERVICE_TIER_LABELS[tier] }} {{ label.toLowerCase() }} price</span
          ><NumberInput
            v-model="form.tierPrices[tier][key]"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
      </div>
      <p v-if="dialogError" class="form__error" role="alert">
        {{ dialogError }}
      </p>
      <div class="dialog__actions">
        <button class="button" type="button" @click="closeDialog">Cancel</button>
        <button class="button button--primary" type="submit" :disabled="isSaving">
          {{ dialog.kind === "create" ? "Add Upstream Model" : "Save" }}
        </button>
      </div>
    </form>
  </AppDialog>

  <AppDialog
    v-if="dialog?.kind === 'delete'"
    v-model:open="isDialogOpen"
    title="Delete Upstream Model"
    :description="`${upstreamModelLabel(dialog.upstreamModel)} is deleted. This can't be undone.`"
  >
    <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
    <div class="dialog__actions">
      <button class="button" type="button" @click="closeDialog">Cancel</button>
      <button
        class="button button--danger"
        type="button"
        :disabled="isSaving"
        @click="deleteUpstreamModel(dialog.upstreamModel)"
      >
        Delete Upstream Model
      </button>
    </div>
  </AppDialog>
</template>
