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
  Search,
  SearchX,
  Trash2,
  Wrench,
} from "@lucide/vue";
import type { Component } from "vue";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  type Capability,
  numberField,
  optionalNumber,
  type Provider,
  type UpstreamModel,
} from "~/lib/upstream";
import { type ActiveFilter, listFilterTokens, searchFilterTokens } from "~/lib/activeFilters";
import { formatNumberInput } from "~/lib/numberInput";

/**
 * Upstream Models with filters, sorting and editing. With `provider` it shows
 * only that Provider's models and drops the Provider filter and column note.
 */
const props = defineProps<{
  providers: Provider[];
  upstreamModels: UpstreamModel[];
  refresh: () => Promise<unknown>;
  provider?: Provider;
  /** The models haven't arrived yet: placeholder rows instead of the count and empty state. */
  isLoading?: boolean;
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
  props.providers.map((provider) => ({ label: provider.name, value: provider.id })),
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

// Held in the URL (?q=…&provider=anthropic,openai&context=128000&released=90&capability=vision,tools&status=…&sort=…)
// so a refresh or a link keeps them. A Provider is its slug, readable and stable.
const searchText = useQueryParam("q", { default: "", isValid: anyText, debounce: 300 });
const providerSlugs = computed(() => props.providers.map((each) => each.slug));
const providerFilter = useQueryList("provider", { isValid: anyText, order: providerSlugs });
const contextFilter = useQueryParam("context", { default: "", isValid: oneOf(CONTEXT_MINIMUMS) });
const releasedFilter = useQueryParam("released", { default: "", isValid: oneOf(RELEASE_WINDOWS) });
const capabilityFilter = useQueryList("capability", {
  isValid: oneOf(CAPABILITIES),
  order: CAPABILITIES,
});
const statusFilter = useQueryList("status", {
  isValid: oneOf(MODEL_STATUSES),
  order: MODEL_STATUSES,
});
const sortOrder = useQueryParam("sort", { default: "newest", isValid: oneOf(SORT_ORDERS) });

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
  const byName = first.upstreamModelId.localeCompare(second.upstreamModelId);
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

const visibleModels = computed(() => {
  const query = searchText.value.trim().toLowerCase();
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
      if (statusFilter.value.length && !statusFilter.value.includes(status)) return false;
      if (!query) return true;
      return [model.upstreamModelId, providerName(model)].some((field) =>
        field.toLowerCase().includes(query),
      );
    })
    .toSorted(compareModels);
});

const activeFilters = computed<ActiveFilter[]>(() => [
  ...searchFilterTokens(searchText),
  ...listFilterTokens("Provider", providerFilter, providerFilterOptions.value),
  ...listFilterTokens("Capability", capabilityFilter, capabilityFilterOptions),
  ...listFilterTokens("Status", statusFilter, statusFilterOptions),
]);

const isFiltered = computed(
  () =>
    searchText.value !== "" ||
    providerFilter.value.length > 0 ||
    contextFilter.value !== "" ||
    releasedFilter.value !== "" ||
    capabilityFilter.value.length > 0 ||
    statusFilter.value.length > 0,
);

function clearFilters(): void {
  searchText.value = "";
  providerFilter.value = [];
  contextFilter.value = "";
  releasedFilter.value = "";
  capabilityFilter.value = [];
  statusFilter.value = [];
}

/** Token counts in full with digit grouping, "1,048,576". */
const tokenFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
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

const shareFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** A cache price as a share of its group's price, "2.5% of input"; empty without both. */
function shareOf(price: number | null, base: number | null, baseName: string): string {
  if (price === null || base === null || base === 0) return "";
  return `${shareFormat.format(price / base)} of ${baseName}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

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
  capabilities: Capability[];
  contextSize: NumberInput;
  maxOutputTokens: NumberInput;
  inputPrice: NumberInput;
  outputPrice: NumberInput;
  cacheReadPrice: NumberInput;
  cacheWritePrice: NumberInput;
  /** "YYYY-MM-DD" from the date input, or "" when empty. */
  releaseDate: string;
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
    capabilities: [],
    contextSize: "",
    maxOutputTokens: "",
    inputPrice: "",
    outputPrice: "",
    cacheReadPrice: "",
    cacheWritePrice: "",
    releaseDate: "",
  };
}

function formFor(upstreamModel: UpstreamModel): UpstreamModelForm {
  return {
    providerId: upstreamModel.providerId,
    upstreamModelId: upstreamModel.upstreamModelId,
    capabilities: [...upstreamModel.capabilities],
    contextSize: upstreamModel.contextSize,
    maxOutputTokens: numberField(upstreamModel.maxOutputTokens),
    inputPrice: numberField(upstreamModel.inputPrice),
    outputPrice: numberField(upstreamModel.outputPrice),
    cacheReadPrice: numberField(upstreamModel.cacheReadPrice),
    cacheWritePrice: numberField(upstreamModel.cacheWritePrice),
    releaseDate: upstreamModel.releaseDate ?? "",
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
    capabilities: form.value.capabilities,
    contextSize: optionalNumber(form.value.contextSize),
    maxOutputTokens: optionalNumber(form.value.maxOutputTokens),
    inputPrice: optionalNumber(form.value.inputPrice),
    outputPrice: optionalNumber(form.value.outputPrice),
    cacheReadPrice: optionalNumber(form.value.cacheReadPrice),
    cacheWritePrice: optionalNumber(form.value.cacheWritePrice),
    releaseDate: form.value.releaseDate || null,
  };
  const failureMessage = "Couldn't save the Upstream Model.";
  if (current.kind === "create") {
    await submitDialog(
      () =>
        $dashboardApi("/upstream-models", {
          method: "POST",
          body: { providerId: form.value.providerId, ...fields },
        }),
      `Added ${fields.upstreamModelId}`,
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
    `Saved ${fields.upstreamModelId}`,
    failureMessage,
  );
}

function deleteUpstreamModel(upstreamModel: UpstreamModel): Promise<void> {
  return deleteRow(
    upstreamModel,
    upstreamModel.upstreamModelId,
    "Couldn't delete the Upstream Model.",
  );
}

function toggleUpstreamModel(upstreamModel: UpstreamModel): Promise<void> {
  return toggleRow(upstreamModel, upstreamModel.upstreamModelId);
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
  <div class="list-filters" role="group" aria-label="Filter Upstream Models">
    <label class="search-control">
      <Search :size="14" />
      <input
        v-model="searchText"
        type="search"
        :placeholder="provider ? 'Search models' : 'Search models or Providers'"
        aria-label="Search Upstream Models"
      />
    </label>
    <AppMultiSelect
      v-if="!provider"
      v-model="providerFilter"
      :options="providerFilterOptions"
      label="Filter by Provider"
      placeholder="All Providers"
      noun="Providers"
    />
    <AppSelect v-model="contextFilter" :options="contextFilterOptions" label="Minimum context" />
    <AppSelect v-model="releasedFilter" :options="releasedFilterOptions" label="Release date" />
    <AppMultiSelect
      v-model="capabilityFilter"
      :options="capabilityFilterOptions"
      label="Filter by capability"
      placeholder="Any capability"
      noun="capabilities"
      match="all"
    />
    <AppMultiSelect
      v-model="statusFilter"
      :options="statusFilterOptions"
      label="Filter by status"
      placeholder="Any status"
      noun="statuses"
    />
    <AppSelect
      v-model="sortOrder"
      :options="sortOptions"
      label="Sort by"
      class="list-filters__sort"
    >
      <template #leading><ArrowDownUp :size="13" class="list-filters__sort-icon" /></template>
    </AppSelect>
    <span v-if="!isLoading" class="filter-note tabular"
      >{{ visibleModels.length }} of {{ scopedModels.length }}</span
    >
    <slot name="actions" :open-create="() => openDialog({ kind: 'create' })" />
  </div>
  <ActiveFilters :filters="activeFilters" @clear-all="clearFilters" />

  <section class="panel table-panel model-table">
    <div class="table-wrap">
      <table v-if="visibleModels.length || isLoading">
        <thead>
          <tr>
            <th>Upstream Model</th>
            <th>Capabilities</th>
            <th class="model-table__num">Context</th>
            <th class="model-table__num">Max output</th>
            <th class="model-table__num">Input $/M</th>
            <th class="model-table__num">Output $/M</th>
            <th class="model-table__num">Released</th>
            <th class="model-table__center">Status</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <LoadingRow v-if="isLoading" :columns="9" />
          <tr
            v-for="model in visibleModels"
            :key="model.id"
            :class="{ 'model-table__row--off': !model.isEnabled }"
          >
            <td>
              <div class="table-entity model-table__entity">
                <ProviderLogo
                  v-if="!provider && providerById.get(model.providerId)"
                  :slug="providerById.get(model.providerId)?.slug ?? ''"
                  :name="providerName(model)"
                  :base-url="providerById.get(model.providerId)?.baseUrl ?? ''"
                />
                <span class="model-table__name">
                  <button
                    class="model-table__open"
                    type="button"
                    :title="model.upstreamModelId"
                    @click="openDialog({ kind: 'details', upstreamModel: model })"
                  >
                    {{ model.upstreamModelId }}
                  </button>
                  <NuxtLink
                    v-if="!provider"
                    class="cell-note"
                    :to="`/providers/${model.providerId}?tab=models`"
                    >{{ providerName(model) }}</NuxtLink
                  >
                </span>
              </div>
            </td>
            <td>
              <span class="capability-icons" role="img" :aria-label="capabilitySummary(model)">
                <span
                  v-for="capability in CAPABILITIES"
                  :key="capability"
                  class="capability-icons__item"
                  :class="{ 'capability-icons__item--on': model.capabilities.includes(capability) }"
                  :title="
                    model.capabilities.includes(capability)
                      ? CAPABILITY_LABELS[capability]
                      : `No ${CAPABILITY_LABELS[capability].toLowerCase()}`
                  "
                  ><component :is="CAPABILITY_ICONS[capability]" :size="14" aria-hidden="true"
                /></span>
              </span>
            </td>
            <td class="model-table__num tabular">
              {{ tokenFormat.format(model.contextSize) }}
            </td>
            <td class="model-table__num tabular">
              {{ model.maxOutputTokens === null ? "—" : tokenFormat.format(model.maxOutputTokens) }}
            </td>
            <td class="model-table__num tabular">
              <strong>{{ formatPrice(model.inputPrice) }}</strong>
              <span v-if="model.cacheReadPrice !== null" class="cell-note" title="Cache read">{{
                formatPrice(model.cacheReadPrice)
              }}</span>
            </td>
            <td class="model-table__num tabular">
              <strong>{{ formatPrice(model.outputPrice) }}</strong>
              <span v-if="model.cacheWritePrice !== null" class="cell-note" title="Cache write">{{
                formatPrice(model.cacheWritePrice)
              }}</span>
            </td>
            <td class="model-table__num tabular">{{ model.releaseDate ?? "—" }}</td>
            <td class="model-table__center">
              <span
                class="status-badge"
                :class="model.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
                >{{ model.isEnabled ? "Enabled" : "Disabled" }}</span
              >
            </td>
            <td>
              <div class="row-actions provider-table__actions">
                <button
                  class="icon-action"
                  type="button"
                  :aria-label="`Edit ${model.upstreamModelId}`"
                  title="Edit"
                  @click="openDialog({ kind: 'edit', upstreamModel: model })"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="icon-action"
                  type="button"
                  :aria-label="`${model.isEnabled ? 'Disable' : 'Enable'} ${model.upstreamModelId}`"
                  :title="model.isEnabled ? 'Disable' : 'Enable'"
                  @click="toggleUpstreamModel(model)"
                >
                  <Power :size="14" />
                </button>
                <button
                  class="icon-action icon-action--danger"
                  type="button"
                  :aria-label="`Delete ${model.upstreamModelId}`"
                  title="Delete"
                  @click="openDialog({ kind: 'delete', upstreamModel: model })"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else-if="isFiltered" :icon="SearchX">
        <strong>No Upstream Model matches these filters.</strong>
        <button class="text-button" type="button" @click="clearFilters">Clear filters</button>
      </EmptyState>
      <EmptyState v-else :icon="Layers">
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
    </div>
  </section>

  <AppDialog
    v-if="detailsModel"
    v-model:open="isDetailsOpen"
    wide
    :title="detailsModel.upstreamModelId"
    :description="`Upstream Model at ${providerName(detailsModel)}. Prices are per million tokens.`"
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
              <dd class="tabular">{{ detailsModel.releaseDate ?? "Unknown" }}</dd>
            </div>
          </dl>
        </section>

        <section class="model-details__section">
          <h3>Pricing <span>USD / 1M tokens</span></h3>
          <dl class="model-details__list">
            <div>
              <dt>Input</dt>
              <dd class="tabular">{{ formatPrice(detailsModel.inputPrice) }}</dd>
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
              <dd class="tabular">{{ formatPrice(detailsModel.outputPrice) }}</dd>
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
        : `Edit ${dialog.upstreamModel.upstreamModelId}`
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
      <p v-if="dialogError" class="form__error" role="alert">{{ dialogError }}</p>
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
    :description="`${dialog.upstreamModel.upstreamModelId} is deleted. This can't be undone.`"
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
