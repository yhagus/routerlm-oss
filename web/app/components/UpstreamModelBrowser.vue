<script setup lang="ts">
import {
  ArrowDownUp,
  ArrowUpRight,
  Braces,
  Brain,
  CalendarClock,
  Clapperboard,
  Eye,
  Images,
  Layers,
  Pencil,
  Plus,
  Power,
  SkipBack,
  SkipForward,
  Stethoscope,
  Trash2,
  Wrench,
} from "@lucide/vue";
import type { Component, WritableComputedRef } from "vue";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  type Capability,
  capabilitiesFor,
  mainBaseUrl,
  MODEL_KIND_LABELS,
  MODEL_KIND_OPTIONS,
  MODEL_KINDS,
  type ModelKind,
  numberField,
  optionalNumber,
  type Provider,
  type ProviderAccount,
  type TierPrices,
  type UpstreamModel,
  upstreamModelLabel,
} from "~/lib/upstream";
import { type ActiveFilter, listFilterTokens } from "~/lib/activeFilters";
import { actionsColumn, type DataTableColumn } from "~/lib/dataTable";
import { formatNumberInput } from "~/lib/numberInput";
import { SERVICE_TIER_LABELS, SERVICE_TIERS, type ServiceTier } from "~/lib/parameterPolicy";
import {
  groupBySharedId,
  groupCapabilities,
  groupName,
  isUpstreamModelGroup,
  rangeOf,
  type UpstreamModelGroup,
  type UpstreamModelRow,
} from "~/lib/upstreamModelGroups";
import { formatCount } from "~/lib/usage";
import {
  type MediaForm,
  mediaFieldsFromForm,
  mediaFormFor,
  mediaLimitLines,
  unitPriceLines,
} from "~/lib/upstreamModelMedia";
import { priceSummary } from "~/lib/upstreamModelPrice";
import { activePricingWindowOf } from "~/lib/pricingWindows";
import { probeBlockReason } from "~/lib/probe";

/**
 * Upstream Models with filters, sorting and editing. With `provider` it shows
 * only that Provider's models and drops the Provider filter and column note.
 * Without it, Upstream Models that share an id across Providers show as one
 * expandable group row.
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
  | { kind: "delete"; upstreamModel: UpstreamModel }
  | { kind: "pricing-windows"; upstreamModel: UpstreamModel };

/** What each icon means, shown in its tooltip. */
const CAPABILITY_HINTS: Record<Capability, string> = {
  vision: "Image input (vision)",
  tools: "Tool calls (function calling)",
  reasoning: "Reasoning (extended thinking)",
  "structured-output": "Structured output (JSON schema)",
  "text-to-video": "Video from a text prompt alone",
  "first-frame": "Video from a first frame",
  "last-frame": "Video to a last frame",
  "reference-images": "Video guided by reference images",
};

const CAPABILITY_ICONS: Record<Capability, Component> = {
  vision: Eye,
  tools: Wrench,
  reasoning: Brain,
  "structured-output": Braces,
  "text-to-video": Clapperboard,
  "first-frame": SkipBack,
  "last-frame": SkipForward,
  "reference-images": Images,
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
const kindFilter = useQueryList("kind", {
  isValid: oneOf(MODEL_KINDS),
  order: MODEL_KINDS,
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

/** Compares two optional numbers, such as prices; models without one always sort last. */
function compareOptionalNumbers(
  first: number | null,
  second: number | null,
  direction: 1 | -1,
): number {
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
      return compareOptionalNumbers(first.inputPrice, second.inputPrice, 1) || byName;
    case "input-desc":
      return compareOptionalNumbers(first.inputPrice, second.inputPrice, -1) || byName;
    case "output-asc":
      return compareOptionalNumbers(first.outputPrice, second.outputPrice, 1) || byName;
    case "context-desc":
      return compareOptionalNumbers(first.contextSize, second.contextSize, -1) || byName;
    default:
      return byName;
  }
}

/** Models the filters keep, before the search. */
const filteredModels = computed(() => {
  const minContext = Number(contextFilter.value || 0);
  const releasedSince = releasedFilter.value ? daysAgo(Number(releasedFilter.value)) : null;
  return scopedModels.value.filter((model) => {
    const slug = providerById.value.get(model.providerId)?.slug ?? "";
    if (providerFilter.value.length && !providerFilter.value.includes(slug)) return false;
    if (kindFilter.value.length && !kindFilter.value.includes(model.kind)) return false;
    // A model without a known context size can't be shown to reach the minimum.
    if ((model.contextSize ?? 0) < minContext) return false;
    // A model without a Release Date can't be shown to fall inside the window.
    if (releasedSince !== null && (model.releaseDate ?? "") < releasedSince) return false;
    // A model must have every picked capability.
    if (!capabilityFilter.value.every((capability) => model.capabilities.includes(capability))) {
      return false;
    }
    const status = model.isEnabled ? "enabled" : "disabled";
    return statusFilter.value.length === 0 || statusFilter.value.includes(status);
  });
});

/** What the search matches: the model's id, its name, or its Provider's name. */
function searchTextOf(model: UpstreamModel): string {
  return [model.upstreamModelId, model.name ?? "", providerName(model)].join("\n");
}

const search = useQuerySearch();
/** The committed search as the DataTable matches it: trimmed, any case. */
const searchQuery = computed(() => search.value.trim().toLowerCase());

/**
 * The rows the DataTable shows, in the picked order. On a Provider's page they
 * are the filtered models, and the DataTable applies the search. Across
 * Providers, the search runs here first so a group forms only from the
 * Upstream Models it keeps: an id with one left is a plain row. The DataTable's
 * own search then keeps every row, since each matches.
 */
const tableRows = computed<UpstreamModelRow[]>(() => {
  if (props.provider) return filteredModels.value.toSorted(compareModels);
  const matching = filteredModels.value.filter((model) =>
    searchTextOf(model).toLowerCase().includes(searchQuery.value),
  );
  return groupBySharedId(matching, compareModels);
});

function rowIdOf(row: UpstreamModelRow): string {
  return isUpstreamModelGroup(row) ? `group:${row.upstreamModelId}` : row.id;
}

/** How many Upstream Models the filters keep for each id, before the search. */
const filteredCountById = computed(() => {
  const counts = new Map<string, number>();
  for (const model of filteredModels.value) {
    counts.set(model.upstreamModelId, (counts.get(model.upstreamModelId) ?? 0) + 1);
  }
  return counts;
});

/** The search dropped some of the id's Upstream Models: the group opens so the matches show. */
function isNarrowedBySearch(group: UpstreamModelGroup): boolean {
  if (searchQuery.value === "") return false;
  return (filteredCountById.value.get(group.upstreamModelId) ?? 0) > group.members.length;
}

/** Groups the reader opened or closed; the others follow `isNarrowedBySearch`. */
const toggledGroups = shallowRef<Record<string, boolean>>({});
// A new search starts over from the groups it narrows.
watch(searchQuery, () => {
  toggledGroups.value = {};
});
const expandedGroups = computed<Record<string, boolean>>({
  get: () =>
    Object.fromEntries(
      tableRows.value
        .filter(isUpstreamModelGroup)
        .map((group) => [
          rowIdOf(group),
          toggledGroups.value[rowIdOf(group)] ?? isNarrowedBySearch(group),
        ]),
    ),
  // The table drops a closed row's id rather than storing false, so record
  // each change against what is shown; otherwise a group the search opened
  // would reopen as soon as it was closed.
  set: (next) => {
    const toggled = { ...toggledGroups.value };
    for (const [id, isOpen] of Object.entries(expandedGroups.value)) {
      const isOpenNext = next[id] === true;
      if (isOpenNext !== isOpen) toggled[id] = isOpenNext;
    }
    toggledGroups.value = toggled;
  },
});

/** "214 Upstream Models · 202 model ids" while groups merge some, "214 Upstream Models" otherwise; a Provider's page keeps the usual count. */
const countLabel = computed(() => {
  const idCount = tableRows.value.length;
  const modelCount = tableRows.value.reduce(
    (count, row) => count + (isUpstreamModelGroup(row) ? row.members.length : 1),
    0,
  );
  if (props.provider) return undefined;
  if (modelCount === idCount) return `${formatCount(modelCount)} Upstream Models`;
  return `${formatCount(modelCount)} Upstream Models · ${formatCount(idCount)} model ${idCount === 1 ? "id" : "ids"}`;
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
  ...listFilterTokens("Kind", kindFilter, MODEL_KIND_OPTIONS),
  ...selectFilterTokens("Context", contextFilter, contextFilterOptions),
  ...selectFilterTokens("Released", releasedFilter, releasedFilterOptions),
  ...listFilterTokens("Capability", capabilityFilter, capabilityFilterOptions),
  ...listFilterTokens("Status", statusFilter, statusFilterOptions),
]);

function clearFilters(): void {
  providerFilter.value = [];
  kindFilter.value = [];
  contextFilter.value = "";
  releasedFilter.value = "";
  capabilityFilter.value = [];
  statusFilter.value = [];
}

const columns: DataTableColumn<UpstreamModelRow>[] = [
  {
    id: "upstreamModel",
    header: "Upstream Model",
    enableHiding: false,
    // The DataTable's search matches this; a group matches through its members' rows.
    accessorFn: (row) =>
      isUpstreamModelGroup(row) ? row.members.map(searchTextOf).join("\n") : searchTextOf(row),
  },
  { id: "kind", header: "Kind" },
  { id: "capabilities", header: "Capabilities" },
  { id: "context", header: "Context" },
  { id: "maxOutput", header: "Max output" },
  { id: "price", header: "Price" },
  { id: "released", header: "Released" },
  { id: "status", header: "Status" },
  actionsColumn(),
];

const NUMERIC_COLUMNS = new Set(["context", "maxOutput", "price", "released"]);
/** Columns faded in a disabled model's row, found by id so hiding a column doesn't shift them. */
const FADED_WHEN_OFF_COLUMNS = new Set(["capabilities", "context", "maxOutput", "price"]);

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

function compareNumbers(first: number, second: number): number {
  return first - second;
}

function compareTexts(first: string, second: string): number {
  return first.localeCompare(second);
}

/** A group's values as "min–max", one value when they agree, or "—" when none is set. */
function formatRange<Value>(
  values: (Value | null)[],
  compare: (first: Value, second: Value) => number,
  format: (value: Value) => string,
): string {
  const range = rangeOf(values, compare);
  if (range === null) return "—";
  const min = format(range.min);
  const max = format(range.max);
  return min === max ? min : `${min}–${max}`;
}

function groupTokenRange(
  group: UpstreamModelGroup,
  tokens: "contextSize" | "maxOutputTokens",
): string {
  return formatRange(
    group.members.map((model) => model[tokens]),
    compareNumbers,
    (value) => tokenFormat.format(value),
  );
}

function groupReleaseRange(group: UpstreamModelGroup): string {
  return formatRange(
    group.members.map((model) => model.releaseDate),
    compareTexts,
    (value) => value,
  );
}

/** A group's Kind is its first member's: models sharing an id almost always share a Kind. */
function rowKind(row: UpstreamModelRow): ModelKind {
  return isUpstreamModelGroup(row) ? row.members[0].kind : row.kind;
}

/** The Pricing Window whose prices a model charges now; a group row has none of its own. */
function activeWindowName(row: UpstreamModelRow): string | undefined {
  if (isUpstreamModelGroup(row)) return undefined;
  return activePricingWindowOf(row.pricingWindows)?.name;
}

function rowCapabilities(row: UpstreamModelRow): Capability[] {
  return isUpstreamModelGroup(row) ? groupCapabilities(row) : row.capabilities;
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

function capabilitySummary(capabilities: Capability[]): string {
  const names = CAPABILITIES.filter((capability) => capabilities.includes(capability)).map(
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
  /** Its Provider needs an endpoint for it. */
  kind: ModelKind;
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
  /** The unit prices and limits of the media Kinds. */
  media: MediaForm;
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
    kind: "chat",
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
    media: mediaFormFor(),
  };
}

function formFor(upstreamModel: UpstreamModel): UpstreamModelForm {
  return {
    providerId: upstreamModel.providerId,
    upstreamModelId: upstreamModel.upstreamModelId,
    name: upstreamModel.name ?? "",
    kind: upstreamModel.kind,
    capabilities: [...upstreamModel.capabilities],
    contextSize: numberField(upstreamModel.contextSize),
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
    media: mediaFormFor(upstreamModel),
  };
}

/**
 * The Kinds the form offers: those the Provider has an endpoint for, plus
 * the model's own, so an edit never shows a blank Kind.
 */
const formKindOptions = computed(() => {
  const endpointKinds = providerById.value
    .get(form.value.providerId)
    ?.endpoints.map((endpoint) => endpoint.kind);
  return MODEL_KIND_OPTIONS.filter(
    (option) => option.value === form.value.kind || endpointKinds?.includes(option.value),
  );
});
const isChatForm = computed(() => form.value.kind === "chat");
const formCapabilities = computed(() => capabilitiesFor(form.value.kind));

function openDialog(next: UpstreamModelDialog): void {
  showDialog(next);
  if (next.kind === "create") form.value = emptyForm();
  if (next.kind === "edit") form.value = formFor(next.upstreamModel);
}

/** The token prices and Service Tiers only chat has; cleared for the other Kinds. */
function chatFieldsFromForm(current: UpstreamModelForm) {
  const isChat = current.kind === "chat";
  return {
    maxOutputTokens: isChat ? optionalNumber(current.maxOutputTokens) : null,
    inputPrice: isChat ? optionalNumber(current.inputPrice) : null,
    outputPrice: isChat ? optionalNumber(current.outputPrice) : null,
    cacheReadPrice: isChat ? optionalNumber(current.cacheReadPrice) : null,
    cacheWritePrice: isChat ? optionalNumber(current.cacheWritePrice) : null,
    serviceTiers: isChat ? SERVICE_TIERS.filter((tier) => current.serviceTiers.includes(tier)) : [],
    tierPrices: isChat ? tierPricesFromForm(current) : {},
  };
}

async function saveUpstreamModel(): Promise<void> {
  const current = dialog.value;
  if (!current || current.kind === "delete") return;
  const fields = {
    upstreamModelId: form.value.upstreamModelId,
    name: form.value.name.trim() || null,
    kind: form.value.kind,
    // Capabilities, token prices and Service Tiers of another Kind are hidden, so they are cleared.
    capabilities: form.value.capabilities.filter((capability) =>
      formCapabilities.value.includes(capability),
    ),
    contextSize: optionalNumber(form.value.contextSize),
    releaseDate: form.value.releaseDate || null,
    ...chatFieldsFromForm(form.value),
    ...mediaFieldsFromForm(form.value.media, form.value.kind),
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

// Only to tell, before the click, that a Provider has no enabled Provider Account to probe with.
const { data: providerAccounts } = useDashboardApi<ProviderAccount[]>("/provider-accounts");
const {
  shownProbe,
  isDialogOpen: isProbeDialogOpen,
  isProbing,
  runProbe,
} = useUpstreamModelProbe();

/** Why the row's Probe action is unavailable, shown as its tooltip; null when it is available. */
function probeUnavailableReason(upstreamModel: UpstreamModel): string | null {
  if (isProbing(upstreamModel)) return "Probing…";
  return probeBlockReason(upstreamModel, providerAccounts.value);
}

function handleProbeClick(upstreamModel: UpstreamModel): void {
  if (probeUnavailableReason(upstreamModel) !== null) return;
  void runProbe(upstreamModel);
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
    v-model:expanded="expandedGroups"
    :rows="tableRows"
    :get-row-id="rowIdOf"
    :get-sub-rows="(row) => (isUpstreamModelGroup(row) ? row.members : undefined)"
    :count-label="countLabel"
    :row-class="
      (row) => ({
        'model-table__row--off': !isUpstreamModelGroup(row) && !row.isEnabled,
        'model-table__row--open': isUpstreamModelGroup(row) && expandedGroups[rowIdOf(row)],
      })
    "
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
        <span class="data-table-filter__label" aria-hidden="true">Kind</span>
        <AppMultiSelect
          v-model="kindFilter"
          :options="MODEL_KIND_OPTIONS"
          label="Filter by Kind"
          placeholder="All Kinds"
          noun="Kinds"
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
    <template #cell-upstreamModel="{ row, isExpanded, toggleExpanded }">
      <div v-if="isUpstreamModelGroup(row)" class="table-entity model-table__entity">
        <span class="model-table__group-logos">
          <ProviderLogo
            v-for="model in row.members.slice(0, 2)"
            :key="model.id"
            :logo="providerById.get(model.providerId)?.logo ?? null"
            :name="providerName(model)"
            :base-url="mainBaseUrl(providerById.get(model.providerId)?.endpoints ?? [])"
          />
        </span>
        <span class="model-table__name">
          <span class="model-table__title">
            <button
              class="model-table__open"
              type="button"
              :aria-expanded="isExpanded"
              :title="`${isExpanded ? 'Hide' : 'Show'} ${row.members.length} Providers`"
              @click="toggleExpanded"
            >
              {{ groupName(row) ?? row.upstreamModelId }}
            </button>
            <CopyIconButton :text="row.upstreamModelId" label="model id" />
          </span>
          <span class="cell-note">{{ row.members.length }} Providers</span>
        </span>
      </div>
      <div v-else class="table-entity model-table__entity">
        <ProviderLogo
          v-if="!provider && providerById.get(row.providerId)"
          :logo="providerById.get(row.providerId)?.logo ?? null"
          :name="providerName(row)"
          :base-url="mainBaseUrl(providerById.get(row.providerId)?.endpoints ?? [])"
        />
        <span class="model-table__name">
          <span class="model-table__title">
            <button
              class="model-table__open"
              type="button"
              :title="upstreamModelLabel(row)"
              @click="openDialog({ kind: 'details', upstreamModel: row })"
            >
              {{ row.name ?? row.upstreamModelId }}
            </button>
            <CopyIconButton :text="row.upstreamModelId" label="model id" />
          </span>
          <NuxtLink
            v-if="!provider"
            class="cell-note"
            :to="`/providers/${row.providerId}?tab=models`"
            >{{ providerName(row) }}</NuxtLink
          >
        </span>
      </div>
    </template>
    <template #cell-kind="{ row }">
      {{ MODEL_KIND_LABELS[rowKind(row)] }}
    </template>
    <template #cell-capabilities="{ row }">
      <TooltipProvider :delay-duration="100">
        <span
          class="capability-icons"
          role="img"
          :aria-label="capabilitySummary(rowCapabilities(row))"
        >
          <Tooltip v-for="capability in capabilitiesFor(rowKind(row))" :key="capability">
            <TooltipTrigger as-child>
              <span
                class="capability-icons__item"
                :class="{
                  'capability-icons__item--on': rowCapabilities(row).includes(capability),
                }"
                ><component :is="CAPABILITY_ICONS[capability]" :size="14" aria-hidden="true"
              /></span>
            </TooltipTrigger>
            <TooltipContent>
              {{
                rowCapabilities(row).includes(capability)
                  ? CAPABILITY_HINTS[capability]
                  : `No ${CAPABILITY_HINTS[capability].toLowerCase()}`
              }}
            </TooltipContent>
          </Tooltip>
        </span>
      </TooltipProvider>
    </template>
    <template #cell-context="{ row }">
      <template v-if="isUpstreamModelGroup(row)">{{
        groupTokenRange(row, "contextSize")
      }}</template>
      <template v-else>{{
        row.contextSize === null ? "—" : tokenFormat.format(row.contextSize)
      }}</template>
    </template>
    <template #cell-maxOutput="{ row }">
      <template v-if="isUpstreamModelGroup(row)">{{
        groupTokenRange(row, "maxOutputTokens")
      }}</template>
      <template v-else>{{
        row.maxOutputTokens === null ? "—" : tokenFormat.format(row.maxOutputTokens)
      }}</template>
    </template>
    <template #cell-price="{ row }">
      <span class="model-table__price">
        <UpstreamModelPrice
          :summary="priceSummary(isUpstreamModelGroup(row) ? row.members : [row], rowKind(row))"
        />
        <span
          v-if="activeWindowName(row)"
          class="status-badge status-badge--good"
          title="Its Window Prices apply now"
          ><CalendarClock :size="12" aria-hidden="true" />{{ activeWindowName(row) }} active
          now</span
        >
      </span>
    </template>
    <template #cell-released="{ row }">{{
      isUpstreamModelGroup(row) ? groupReleaseRange(row) : (row.releaseDate ?? "—")
    }}</template>
    <!-- A group row has no status or actions of its own: its Providers' rows do. -->
    <template #cell-status="{ row }">
      <span
        v-if="!isUpstreamModelGroup(row)"
        class="status-badge"
        :class="row.isEnabled ? 'status-badge--good' : 'status-badge--warn'"
        >{{ row.isEnabled ? "Enabled" : "Disabled" }}</span
      >
    </template>
    <template #cell-actions="{ row }">
      <div v-if="!isUpstreamModelGroup(row)" class="row-actions provider-table__actions">
        <!-- aria-disabled, not disabled: a disabled button shows no tooltip, and the tooltip says why. -->
        <button
          class="icon-action"
          type="button"
          :aria-label="`Probe ${upstreamModelLabel(row)}`"
          :aria-disabled="probeUnavailableReason(row) !== null"
          :aria-busy="isProbing(row)"
          :title="probeUnavailableReason(row) ?? 'Probe each Provider Account'"
          @click="handleProbeClick(row)"
        >
          <span v-if="isProbing(row)" class="spinner" aria-hidden="true" />
          <Stethoscope v-else :size="14" />
        </button>
        <button
          v-if="row.kind === 'chat'"
          class="icon-action"
          type="button"
          :aria-label="`Pricing Windows of ${upstreamModelLabel(row)}`"
          title="Pricing Windows"
          @click="openDialog({ kind: 'pricing-windows', upstreamModel: row })"
        >
          <CalendarClock :size="14" />
        </button>
        <button
          class="icon-action"
          type="button"
          :aria-label="`Edit ${upstreamModelLabel(row)}`"
          title="Edit"
          @click="openDialog({ kind: 'edit', upstreamModel: row })"
        >
          <Pencil :size="14" />
        </button>
        <button
          class="icon-action"
          type="button"
          :aria-label="`${row.isEnabled ? 'Disable' : 'Enable'} ${upstreamModelLabel(row)}`"
          :title="row.isEnabled ? 'Disable' : 'Enable'"
          @click="toggleUpstreamModel(row)"
        >
          <Power :size="14" />
        </button>
        <button
          class="icon-action icon-action--danger"
          type="button"
          :aria-label="`Delete ${upstreamModelLabel(row)}`"
          title="Delete"
          @click="openDialog({ kind: 'delete', upstreamModel: row })"
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
    :description="`${MODEL_KIND_LABELS[detailsModel.kind]} ${detailsModel.name === null ? 'Upstream Model' : detailsModel.upstreamModelId} at ${providerName(detailsModel)}.`"
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

      <section
        v-if="capabilitiesFor(detailsModel.kind).length > 0"
        class="model-details__section"
        aria-label="Capabilities"
      >
        <h3>Capabilities</h3>
        <ul class="model-details__capabilities">
          <li
            v-for="capability in capabilitiesFor(detailsModel.kind)"
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
            <div v-if="detailsModel.contextSize !== null">
              <dt>Context window</dt>
              <dd class="tabular">
                {{ formatNumberInput(String(detailsModel.contextSize)) }}
                <span>{{ compactTokenFormat.format(detailsModel.contextSize) }} tokens</span>
              </dd>
            </div>
            <div v-for="line in mediaLimitLines(detailsModel)" :key="line.label">
              <dt>{{ line.label }}</dt>
              <dd class="tabular">{{ line.value }}</dd>
            </div>
            <div v-if="detailsModel.kind === 'chat'">
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

        <section v-if="detailsModel.kind !== 'chat'" class="model-details__section">
          <h3>Pricing <span>USD</span></h3>
          <dl class="model-details__list">
            <div v-for="line in unitPriceLines(detailsModel)" :key="line.label">
              <dt>{{ line.label }}</dt>
              <dd class="tabular">{{ line.value }}</dd>
            </div>
            <div v-if="unitPriceLines(detailsModel).length === 0">
              <dt>Prices</dt>
              <dd>Not published</dd>
            </div>
          </dl>
        </section>
        <section v-else class="model-details__section">
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
        <div class="field">
          <span class="field__label">Kind</span>
          <AppSelect v-model="form.kind" :options="formKindOptions" label="Kind" />
        </div>
      </div>
      <p class="form__hint">A Provider offers the Kinds it has an endpoint for.</p>
      <fieldset v-if="formCapabilities.length > 0" class="check-group">
        <legend class="field__label">Capabilities</legend>
        <label v-for="capability in formCapabilities" :key="capability" class="check-field"
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
        /></label>
        <label v-if="isChatForm" class="field"
          ><span class="field__label">Max output (tokens)</span
          ><NumberInput
            v-model="form.maxOutputTokens"
            class="text-input"
            whole
            tokens
            :min="1"
            placeholder="e.g. 64k"
        /></label>
        <label v-if="isChatForm" class="field"
          ><span class="field__label">Input price</span
          ><NumberInput
            v-model="form.inputPrice"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
        <label v-if="isChatForm" class="field"
          ><span class="field__label">Output price</span
          ><NumberInput
            v-model="form.outputPrice"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
        <label v-if="isChatForm" class="field"
          ><span class="field__label">Cache read price</span
          ><NumberInput
            v-model="form.cacheReadPrice"
            class="text-input"
            :min="0"
            prefix="$"
            suffix="/ 1M tokens"
            unit-label="US dollars per million tokens"
        /></label>
        <label v-if="isChatForm" class="field"
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
      <UpstreamModelMediaFields v-model="form.media" :kind="form.kind" />
      <fieldset v-if="isChatForm" class="check-group">
        <legend class="field__label">Service Tiers</legend>
        <label v-for="tier in SERVICE_TIERS" :key="tier" class="check-field"
          ><input v-model="form.serviceTiers" type="checkbox" :value="tier" />
          {{ SERVICE_TIER_LABELS[tier] }}</label
        >
      </fieldset>
      <p v-if="isChatForm" class="form__hint">
        A requested tier the model doesn't accept is dropped. A tier price left empty is the
        standard price.
      </p>
      <div v-for="tier in isChatForm ? form.serviceTiers : []" :key="tier" class="form__grid">
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

  <UpstreamModelPricingWindowsDialog
    v-if="dialog?.kind === 'pricing-windows'"
    :key="dialog.upstreamModel.id"
    v-model:open="isDialogOpen"
    :upstream-model="dialog.upstreamModel"
    :refresh="refresh"
  />

  <UpstreamModelProbeDialog
    v-if="shownProbe"
    :key="shownProbe.upstreamModel.id"
    v-model:open="isProbeDialogOpen"
    :probe="shownProbe"
  />
</template>
