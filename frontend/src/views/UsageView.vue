<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  RefreshCw,
  Search,
  X,
} from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";
import { currency, date, displayName, number } from "@/lib/format";
import type {
  ProviderConnection,
  UsageTrendBy,
  RequestDetailsResponse,
  UsageAggregate,
  UsageKeyRow,
  UsagePeriod,
  UsageProviderRow,
  UsageRecord,
} from "@/types/api";
import DataTable from "@/components/app/DataTable.vue";
import EmptyState from "@/components/app/EmptyState.vue";
import Button from "@/components/ui/button.vue";
import Card from "@/components/ui/card.vue";
import TabSwitcher from "@/components/ui/tab-switcher.vue";
import Badge from "@/components/ui/badge.vue";
import Combobox from "@/components/ui/combobox.vue";
import Select from "@/components/ui/select.vue";
import ProviderTopology from "@/components/usage/ProviderTopology.vue";
import UsageTrendChart from "@/components/usage/UsageTrendChart.vue";
import UsageOverviewPanel from "@/components/usage/UsageOverviewPanel.vue";
import UsageModelsTable from "@/components/usage/UsageModelsTable.vue";

type Tab =
  | "overview"
  | "details"
  | "api-keys"
  | "providers"
  | "accounts"
  | "models"
  | "combos";
type Drawer =
  | { type: "request"; value: UsageRecord }
  | { type: "provider"; value: UsageProviderRow }
  | { type: "key"; value: UsageKeyRow }
  | null;
const tabs: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["details", "Requests"],
  ["api-keys", "API Key"],
  ["providers", "Providers"],
  ["accounts", "Accounts"],
  ["models", "Models"],
  ["combos", "Combos"],
];
const tabOptions = tabs.map(([value, label]) => ({ value, label }));
const periods: Array<[UsagePeriod, string]> = [
  ["1h", "1H"],
  ["today", "Today"],
  ["24h", "24h"],
  ["7d", "7D"],
  ["30d", "30D"],
  ["60d", "60D"],
  ["all", "All Time"],
];
const route = useRoute();
const router = useRouter();
const tab = ref<Tab>("overview");
const overviewPeriod = ref<UsagePeriod>("today");
const providersPeriod = ref<UsagePeriod>("all");
const keysPeriod = ref<UsagePeriod>("all");
const accountsPeriod = ref<UsagePeriod>("all");
const modelsPeriod = ref<UsagePeriod>("all");
const combosPeriod = ref<UsagePeriod>("all");
const autoRefresh = ref(true);
const REFRESH_INTERVAL_SEC = 10;
const refreshCountdown = ref(REFRESH_INTERVAL_SEC);
const refreshKey = ref(0);
const refreshing = ref(false);
const requestPage = ref(1);
const requestPageSize = ref(20);
const entityPage = ref(1);
const entityPageSize = ref(10);
const searchInput = ref("");
const search = ref("");
const EMPTY_REQUEST_FILTERS = {
  provider: "",
  model: "",
  outcome: "",
  search: "",
  startDate: "",
  endDate: "",
};
const filters = ref({ ...EMPTY_REQUEST_FILTERS });
const requestSearchInput = ref("");
let requestSearchTimer: number | undefined;
// Categorical filters for the entity tabs. One shared shape, reset on tab change.
const EMPTY_ENTITY_FILTERS = {
  provider: "all",
  status: "all",
  visibility: "all",
  activity: "all",
  health: "all",
  sort: "requests",
};
const entityFilters = ref({ ...EMPTY_ENTITY_FILTERS });
const drawer = ref<Drawer>(null);
const live = ref<{
  activeRequests: Array<{
    model: string;
    provider: string;
    account: string;
    count: number;
  }>;
  recentRequests: Array<{
    detailId?: string | null;
    timestamp: string;
    model: string;
    displayModel?: string;
    provider?: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    status?: string;
  }>;
  errorProvider?: string | null;
}>({ activeRequests: [], recentRequests: [] });
let refreshTimer: number | undefined;
let searchTimer: number | undefined;
let stream: EventSource | undefined;
let liveWatchdog: number | undefined;

function connectStream() {
  stream = new EventSource("/api/usage/stream");
  stream.onmessage = (event) => {
    try {
      live.value = JSON.parse(event.data);
    } catch {
      /* ignore malformed stream messages */
    }
  };
}

const period = computed(() =>
  tab.value === "providers"
    ? providersPeriod.value
    : tab.value === "api-keys"
      ? keysPeriod.value
      : tab.value === "accounts"
        ? accountsPeriod.value
        : tab.value === "models"
          ? modelsPeriod.value
          : tab.value === "combos"
            ? combosPeriod.value
            : overviewPeriod.value,
);
const hasPeriod = computed(
  () =>
    tab.value === "overview" ||
    tab.value === "providers" ||
    tab.value === "api-keys" ||
    tab.value === "accounts" ||
    tab.value === "models" ||
    tab.value === "combos",
);
const hasHeaderActions = computed(
  () => hasPeriod.value || tab.value !== "overview",
);
const periodOptions = computed(() =>
  periods.map(([value, label]) => ({ value, label })),
);
const providerFilterOptions = computed(() => [
  { value: "", label: "All providers" },
  ...(providerOptions.data.value?.providers || []).map((provider) => ({
    value: provider.id,
    label: provider.name,
  })),
]);
const outcomeOptions = [
  { value: "", label: "All outcomes" },
  { value: "success", label: "Success" },
  { value: "error", label: "Errors" },
];
const entityProviderOptions = computed(() => [
  { value: "all", label: "All providers" },
  ...(providerOptions.data.value?.providers || []).map((provider) => ({
    value: provider.id,
    label: provider.name,
  })),
]);
const healthOptions = [
  { value: "all", label: "All health" },
  { value: "failing", label: "Has errors" },
  { value: "healthy", label: "No errors" },
];
const keyStatusOptions = [
  { value: "all", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
];
const visibilityOptions = [
  { value: "all", label: "Any visibility" },
  { value: "private", label: "Private" },
  { value: "public", label: "Public" },
  { value: "event", label: "Event" },
];
const keyActivityOptions = [
  { value: "all", label: "Any usage" },
  { value: "used", label: "Used" },
  { value: "unused", label: "Never used" },
];
const sortOptions = [
  { value: "requests", label: "Most requests" },
  { value: "tokens", label: "Most tokens" },
  { value: "cost", label: "Highest cost" },
  { value: "recent", label: "Recently used" },
  { value: "name", label: "Name A–Z" },
];
const hasRequestFilters = computed(
  () =>
    Boolean(requestSearchInput.value) ||
    Object.entries(filters.value).some(
      ([key, value]) => Boolean(value) && key !== "search",
    ),
);
const hasEntityFilters = computed(
  () =>
    Boolean(searchInput.value) ||
    Object.entries(entityFilters.value).some(
      ([key, value]) =>
        value !==
        EMPTY_ENTITY_FILTERS[key as keyof typeof EMPTY_ENTITY_FILTERS],
    ),
);
const requestPageSizeOptions = [20, 50, 100].map((value) => ({
  value,
  label: `${value} / page`,
}));
const entityPageSizeOptions = [10, 20, 50].map((value) => ({
  value,
  label: `${value} / page`,
}));
const overviewData = useQuery({
  queryKey: ["usage", "overview", overviewPeriod, refreshKey],
  queryFn: () => api.usage.overview(overviewPeriod.value),
  enabled: computed(() => tab.value === "overview"),
  placeholderData: (previous) => previous,
});
const overviewPeriodLabel = computed(
  () =>
    (
      ({
        "1h": "over the last hour",
        today: "so far today",
        "24h": "over the last 24 hours",
        "7d": "over the last 7 days",
        "30d": "over the last 30 days",
        "60d": "over the last 60 days",
        all: "across all time",
      }) as Record<string, string>
    )[overviewPeriod.value] || "",
);
const topologyConnections = useQuery({
  queryKey: ["usage", "topology-connections", refreshKey],
  queryFn: api.providers.list,
  enabled: computed(() => tab.value === "overview"),
});
const topologyNodes = useQuery({
  queryKey: ["usage", "topology-nodes", refreshKey],
  queryFn: api.nodes.list,
  enabled: computed(() => tab.value === "overview"),
});
const topologyCatalog = useQuery({
  queryKey: ["usage", "topology-catalog", refreshKey],
  queryFn: () => api.providers.catalog(),
  enabled: computed(() => tab.value === "overview"),
});
const providerOptions = useQuery({
  queryKey: ["usage", "provider-options"],
  queryFn: api.usage.providerOptions,
  enabled: computed(
    () =>
      tab.value === "details" ||
      tab.value === "accounts" ||
      tab.value === "models",
  ),
});
const requests = useQuery({
  queryKey: [
    "usage",
    "details",
    requestPage,
    requestPageSize,
    filters,
    refreshKey,
  ],
  queryFn: () =>
    api.usage.requestDetails({
      page: requestPage.value,
      pageSize: requestPageSize.value,
      ...filters.value,
    }),
  enabled: computed(() => tab.value === "details"),
});
const providers = useQuery({
  queryKey: [
    "usage",
    "providers",
    providersPeriod,
    entityPage,
    entityPageSize,
    search,
    entityFilters,
    refreshKey,
  ],
  queryFn: () =>
    api.usage.providers(
      providersPeriod.value,
      entityPage.value,
      entityPageSize.value,
      search.value,
      entityFilters.value,
    ),
  enabled: computed(() => tab.value === "providers"),
});
const keys = useQuery({
  queryKey: [
    "usage",
    "keys",
    keysPeriod,
    entityPage,
    entityPageSize,
    search,
    entityFilters,
    refreshKey,
  ],
  queryFn: () =>
    api.usage.apiKeys(
      keysPeriod.value,
      entityPage.value,
      entityPageSize.value,
      search.value,
      entityFilters.value,
    ),
  enabled: computed(() => tab.value === "api-keys"),
});
const accounts = useQuery({
  queryKey: [
    "usage",
    "accounts",
    accountsPeriod,
    entityPage,
    entityPageSize,
    search,
    entityFilters,
    refreshKey,
  ],
  queryFn: () =>
    api.usage.accounts(
      accountsPeriod.value,
      entityPage.value,
      entityPageSize.value,
      search.value,
      entityFilters.value,
    ),
  enabled: computed(() => tab.value === "accounts"),
});
const models = useQuery({
  queryKey: [
    "usage",
    "models",
    modelsPeriod,
    entityPage,
    entityPageSize,
    search,
    entityFilters,
    refreshKey,
  ],
  queryFn: () =>
    api.usage.models(
      modelsPeriod.value,
      entityPage.value,
      entityPageSize.value,
      search.value,
      entityFilters.value,
    ),
  enabled: computed(() => tab.value === "models"),
});
const combos = useQuery({
  queryKey: [
    "usage",
    "combos",
    combosPeriod,
    entityPage,
    entityPageSize,
    search,
    entityFilters,
    refreshKey,
  ],
  queryFn: () =>
    api.usage.combos(
      combosPeriod.value,
      entityPage.value,
      entityPageSize.value,
      search.value,
      entityFilters.value,
    ),
  enabled: computed(() => tab.value === "combos"),
});
// One trend query per tab. Only the active tab fetches, and the period follows
// that tab's own selector.
const trendTab = computed<UsageTrendBy | null>(() =>
  tab.value === "providers"
    ? "provider"
    : tab.value === "api-keys"
      ? "apiKey"
      : tab.value === "accounts"
        ? "account"
        : tab.value === "models"
          ? "model"
          : tab.value === "combos"
            ? "combo"
            : null,
);
const trend = useQuery({
  queryKey: ["usage", "trend", trendTab, period, refreshKey],
  queryFn: () => api.usage.trend(trendTab.value as UsageTrendBy, period.value),
  enabled: computed(() => trendTab.value !== null),
  placeholderData: (previous) => previous,
});
const trendTitle = computed(
  () =>
    (
      ({
        provider: "Tokens by provider",
        apiKey: "Tokens by API key",
        account: "Tokens by account",
        model: "Tokens by model",
        combo: "Tokens by combo",
      }) as Record<string, string>
    )[trendTab.value || ""] || "Trend",
);
const requestsTrend = useQuery({
  queryKey: ["usage", "trend", "requests-tab", refreshKey],
  queryFn: () => api.usage.trend("provider", "7d"),
  enabled: computed(() => tab.value === "details"),
  placeholderData: (previous) => previous,
});
const accountConnections = useQuery({
  queryKey: ["usage", "accounts-connections", refreshKey],
  queryFn: api.providers.list,
  enabled: computed(() => tab.value === "accounts"),
});
const accountLabelsMap = computed(() => {
  const map = new Map<string, string>();
  for (const connection of (accountConnections.data.value as
    ProviderConnection[] | undefined) || [])
    map.set(
      connection.id,
      connection.name?.trim() || connection.email?.trim() || connection.id,
    );
  return map;
});
function entityDisplay(name: string): string {
  return tab.value === "accounts"
    ? accountLabelsMap.value.get(name) || name
    : name || "—";
}
const providerDetail = useQuery({
  queryKey: [
    "usage",
    "provider-detail",
    computed(() =>
      drawer.value?.type === "provider" ? drawer.value.value.id : "",
    ),
    providersPeriod,
  ],
  queryFn: () =>
    api.usage.providerDetail(
      (drawer.value as { type: "provider"; value: UsageProviderRow }).value.id,
      providersPeriod.value,
    ),
  enabled: computed(() => drawer.value?.type === "provider"),
});
const keyDetail = useQuery({
  queryKey: [
    "usage",
    "key-detail",
    computed(() => (drawer.value?.type === "key" ? drawer.value.value.id : "")),
    keysPeriod,
  ],
  queryFn: () =>
    api.usage.apiKeyDetail(
      (drawer.value as { type: "key"; value: UsageKeyRow }).value.id,
      keysPeriod.value,
    ),
  enabled: computed(() => drawer.value?.type === "key"),
});
const requestData = computed(
  () => requests.data.value as RequestDetailsResponse | undefined,
);
const entityPagination = computed(() =>
  tab.value === "providers"
    ? providers.data.value?.pagination
    : tab.value === "accounts"
      ? accounts.data.value?.pagination
      : tab.value === "models"
        ? models.data.value?.pagination
        : tab.value === "combos"
          ? combos.data.value?.pagination
          : keys.data.value?.pagination,
);
const entityRows = computed(() =>
  tab.value === "accounts"
    ? accounts.data.value?.items || []
    : tab.value === "models"
      ? models.data.value?.items || []
      : tab.value === "combos"
        ? combos.data.value?.items || []
        : [],
);
const listLoading = computed(() =>
  tab.value === "accounts"
    ? accounts.isPending.value
    : tab.value === "models"
      ? models.isPending.value
      : tab.value === "combos"
        ? combos.isPending.value
        : false,
);
const listRows = computed(
  () =>
    entityRows.value as Array<{
      id: string;
      name: string;
      usage: UsageAggregate;
    }>,
);
const tabHeaderTitle = computed(
  () =>
    (
      ({
        accounts: "Account usage",
        models: "Model usage",
        combos: "Combo usage",
        providers: "Provider usage",
        "api-keys": "API Key usage",
      }) as Record<string, string>
    )[tab.value] || "Usage",
);
const tabHeaderSubtitle = computed(
  () =>
    (
      ({
        accounts: "account",
        models: "model",
        combos: "combo",
        providers: "provider",
        "api-keys": "API key",
      }) as Record<string, string>
    )[tab.value] || "entity",
);
const tabHeaderPlaceholder = computed(
  () =>
    (
      ({
        accounts: "Search by account...",
        models: "Search by model...",
        combos: "Search by combo...",
        providers: "Search by provider...",
        "api-keys": "Search by name...",
      }) as Record<string, string>
    )[tab.value] || "Search...",
);
const entityDetail = computed<Record<string, unknown> | null>(
  () =>
    (drawer.value?.type === "provider"
      ? providerDetail.data.value
      : drawer.value?.type === "key"
        ? keyDetail.data.value
        : null) as Record<string, unknown> | null,
);

type StatRow = {
  id?: string;
  provider?: string;
  rawModel?: string | null;
  requests?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost?: number;
  lastUsed?: string;
  ip?: string;
  model?: string;
  timestamp?: string;
  status?: string;
  clientIp?: string | null;
  connectionId?: string | null;
  apiKeyId?: string | null;
  totalTokens?: number;
};
type EntityStats = {
  totalRequests?: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalCachedTokens?: number;
  totalCost?: number;
  totalTokens?: number;
  lastUsed?: string | null;
  uniqueIps?: number;
  byModel?: StatRow[];
  byIp?: StatRow[];
  byAccount?: StatRow[];
  byApiKey?: StatRow[];
  byProvider?: StatRow[];
  recentRequests?: StatRow[];
  highlights?: {
    mostRequestedModel?: StatRow | null;
    mostTokensModel?: StatRow | null;
  };
};
const detail = computed<EntityStats>(
  () => (entityDetail.value || {}) as EntityStats,
);
const ipSortDir = ref<"desc" | "asc">("desc");
const sortedByIp = computed<StatRow[]>(() => {
  const rows = detail.value.byIp || [];
  return [...rows].sort((left, right) => {
    const leftTime = left.lastUsed ? new Date(left.lastUsed).getTime() : 0;
    const rightTime = right.lastUsed ? new Date(right.lastUsed).getTime() : 0;
    return ipSortDir.value === "desc"
      ? rightTime - leftTime
      : leftTime - rightTime;
  });
});
function toggleIpSort() {
  ipSortDir.value = ipSortDir.value === "desc" ? "asc" : "desc";
}
const drawerConnections = useQuery({
  queryKey: ["usage", "drawer-connections", refreshKey],
  queryFn: api.providers.list,
  enabled: computed(() => drawer.value?.type === "provider"),
});
const accountName = computed(() => {
  const map = new Map<string, string>();
  for (const connection of (drawerConnections.data.value as
    ProviderConnection[] | undefined) || [])
    map.set(
      connection.id,
      connection.name?.trim() || connection.email?.trim() || connection.id,
    );
  return map;
});
function accountLabel(id: string) {
  return accountName.value.get(id) || id;
}
function keyLabel(raw: string) {
  return raw.length > 16 ? `${raw.slice(0, 8)}…${raw.slice(-4)}` : raw;
}
function rowRequests(row: StatRow) {
  return Number(row.requests || 0);
}
function rowIn(row: StatRow) {
  return Number(row.promptTokens || 0);
}
function rowOut(row: StatRow) {
  return Number(row.completionTokens || 0);
}
function rowCost(row: StatRow) {
  return Number(row.cost || 0);
}
const topologyProviders = computed(() => {
  const connections = topologyConnections.data.value || [];
  const nodes = topologyNodes.data.value || [];
  const catalog = topologyCatalog.data.value?.providers || [];
  const nodeNames = new Map(nodes.map((node) => [node.id, node.name || null]));
  const catalogById = new Map(
    catalog.map((provider) => [provider.id, provider]),
  );
  const seen = new Set<string>();
  const rows: Array<{
    provider: string;
    name?: string | null;
    nodeName?: string | null;
  }> = [];

  for (const connection of connections) {
    if (
      connection.isActive === false ||
      !connection.provider ||
      seen.has(connection.provider)
    )
      continue;
    const catalogEntry = catalogById.get(connection.provider);
    if (catalogEntry && !catalogEntry.serviceKinds.includes("llm")) continue;
    seen.add(connection.provider);
    rows.push({
      provider: connection.provider,
      name: connection.name,
      nodeName: nodeNames.get(connection.provider) || null,
    });
  }

  for (const provider of catalog) {
    if (
      !provider.noAuth ||
      seen.has(provider.id) ||
      !provider.serviceKinds.includes("llm")
    )
      continue;
    seen.add(provider.id);
    rows.push({ provider: provider.id, name: provider.name });
  }

  return rows;
});
const topologyPanelRef = ref<HTMLElement | null>(null);
const topologyPanelHeight = ref(320);
const desktopLayout = ref(false);
let topologyResizeObserver: ResizeObserver | undefined;

// The content container below the overview panel uses pb-10 (2.5rem = 40px).
// A small safety gap keeps the boxes from touching the viewport bottom.
const TOPOLOGY_BOTTOM_PADDING = 40;
const TOPOLOGY_SAFETY_GAP = 12;
const TOPOLOGY_MIN_HEIGHT = 320;
const TOPOLOGY_FLOOR = 220;

function isDesktopLayout() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 1024px)").matches
  );
}

function measureTopologyHeight() {
  const panel = topologyPanelRef.value;
  if (!panel || !desktopLayout.value) return;
  const top = panel.getBoundingClientRect().top;
  const available = Math.round(
    window.innerHeight - top - TOPOLOGY_BOTTOM_PADDING - TOPOLOGY_SAFETY_GAP,
  );
  topologyPanelHeight.value = Math.max(TOPOLOGY_MIN_HEIGHT, available);
}

function refreshTopologyLayout() {
  desktopLayout.value = isDesktopLayout();
  measureTopologyHeight();
}

function syncTopologyObserver() {
  topologyResizeObserver?.disconnect();
  if (topologyResizeObserver && topologyPanelRef.value)
    topologyResizeObserver.observe(topologyPanelRef.value);
  measureTopologyHeight();
}

const panelHeight = computed(() =>
  desktopLayout.value
    ? Math.max(topologyPanelHeight.value, TOPOLOGY_FLOOR)
    : undefined,
);
const lastProvider = computed(
  () => live.value.recentRequests[0]?.provider || "",
);
const errorProvider = computed(() => live.value.errorProvider || "");

function relative(value: string | null | undefined) {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  return seconds < 60
    ? seconds
      ? `${seconds}s ago`
      : "Just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}
function inputTokens(record: UsageRecord) {
  return Number(
    record.tokens?.prompt_tokens ??
      record.tokens?.input_tokens ??
      record.prompt_tokens ??
      0,
  );
}
function cachedTokens(record: UsageRecord) {
  return Number(
    record.tokens?.cached_tokens ?? record.tokens?.cache_read_input_tokens ?? 0,
  );
}
function outputTokens(record: UsageRecord) {
  return Number(
    record.tokens?.completion_tokens ?? record.completion_tokens ?? 0,
  );
}
function tokensPerSecond(record: UsageRecord): number | null {
  const tps = record.latency?.tokensPerSecond;
  if (typeof tps === "number" && Number.isFinite(tps) && tps > 0) return tps;
  // Fallback: derive client-side from output tokens and generation time when
  // the persisted detail predates the tokensPerSecond field.
  const total = record.latency?.total;
  const ttft = record.latency?.ttft ?? 0;
  if (typeof total !== "number" || total <= 0) return null;
  const out = outputTokens(record);
  if (out <= 0) return null;
  const generationMs = total - (ttft || 0);
  if (generationMs <= 0) return null;
  return Math.round((out / (generationMs / 1000)) * 100) / 100;
}
function okay(status: string | null | undefined) {
  return !status || status === "ok" || status === "success";
}
function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function reasoningTokens(record: UsageRecord): number | null {
  const tokens = objectValue(record.tokens);
  if (!tokens) return null;
  const completionDetails =
    objectValue(tokens.completion_tokens_details) ||
    objectValue(tokens.output_tokens_details);
  for (const value of [
    tokens.reasoning_tokens,
    tokens.thoughtsTokenCount,
    completionDetails?.reasoning_tokens,
    completionDetails?.thoughtsTokenCount,
  ]) {
    const parsed = finiteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}
function signalCount(
  record: UsageRecord,
  kind: "thinking" | "tools",
): number | null {
  let found = false;
  let count = 0;
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const item = objectValue(current);
    if (!item) return;
    const type = String(item.type || "");
    if (kind === "thinking") {
      if (["thinking", "reasoning"].includes(type)) {
        found = true;
        count++;
      }
      if (
        typeof item.reasoning_content === "string" &&
        item.reasoning_content
      ) {
        found = true;
        count++;
      }
      if (typeof item.thinking === "string" && item.thinking) {
        found = true;
        count++;
      }
    } else {
      if (Array.isArray(item.tool_calls)) {
        found = true;
        count += item.tool_calls.length;
      }
      if (["tool_use", "function_call", "custom_tool_call"].includes(type)) {
        found = true;
        count++;
      }
    }
    Object.entries(item).forEach(([key, child]) => {
      if (
        (kind === "tools" && key === "tool_calls") ||
        (kind === "thinking" && ["reasoning_content", "thinking"].includes(key))
      )
        return;
      visit(child);
    });
  };
  visit(record.response);
  if (!found) visit(record.providerResponse);
  return found ? count : null;
}
function thinkingBlocks(record: UsageRecord) {
  return signalCount(record, "thinking");
}
function toolCalls(record: UsageRecord) {
  return signalCount(record, "tools");
}
function activityLabel(record: UsageRecord) {
  const thinking = reasoningTokens(record);
  const blocks = thinkingBlocks(record);
  const tools = toolCalls(record);
  const labels: string[] = [];
  if (thinking !== null) labels.push(`${number(thinking)} thinking`);
  else if (blocks !== null && blocks > 0)
    labels.push(`${number(blocks)} thinking block${blocks === 1 ? "" : "s"}`);
  if (tools !== null)
    labels.push(`${number(tools)} tool call${tools === 1 ? "" : "s"}`);
  return labels.length ? labels.join(" · ") : "—";
}
async function openLiveRequest(entry: {
  detailId?: string | null;
  timestamp: string;
  model: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  status?: string;
}) {
  const fallback: UsageRecord = {
    id: `${entry.timestamp}-${entry.model}`,
    timestamp: entry.timestamp,
    provider: entry.provider || null,
    model: entry.model || null,
    connection_id: null,
    endpoint: null,
    prompt_tokens: entry.promptTokens,
    completion_tokens: entry.completionTokens,
    cost: 0,
    status: entry.status || "ok",
  };
  if (entry.detailId) {
    try {
      drawer.value = {
        type: "request",
        value: await api.usage.requestDetail(entry.detailId),
      };
      return;
    } catch {
      // Keep the lightweight live record available if observability data expired.
    }
  }
  drawer.value = { type: "request", value: fallback };
}
function changeTab(next: Tab) {
  if (next !== tab.value)
    void router.push({ query: { ...route.query, tab: next } });
}
function changePeriod(next: UsagePeriod) {
  if (tab.value === "overview") overviewPeriod.value = next;
  if (tab.value === "providers") providersPeriod.value = next;
  if (tab.value === "api-keys") keysPeriod.value = next;
  if (tab.value === "accounts") accountsPeriod.value = next;
  if (tab.value === "models") modelsPeriod.value = next;
  if (tab.value === "combos") combosPeriod.value = next;
  entityPage.value = 1;
}
function changeSearch(event: Event) {
  searchInput.value = (event.target as HTMLInputElement).value;
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    search.value = searchInput.value;
    entityPage.value = 1;
  }, 300);
}
function refresh() {
  refreshing.value = true;
  refreshCountdown.value = REFRESH_INTERVAL_SEC;
  refreshKey.value++;
  window.setTimeout(() => {
    refreshing.value = false;
  }, 500);
}
function clearFilters() {
  filters.value = { ...EMPTY_REQUEST_FILTERS };
  requestSearchInput.value = "";
  requestPage.value = 1;
}
function changeRequestSearch(event: Event) {
  requestSearchInput.value = (event.target as HTMLInputElement).value;
  if (requestSearchTimer) window.clearTimeout(requestSearchTimer);
  requestSearchTimer = window.setTimeout(() => {
    filters.value = { ...filters.value, search: requestSearchInput.value };
  }, 300);
}
function clearEntityFilters() {
  entityFilters.value = { ...EMPTY_ENTITY_FILTERS };
  searchInput.value = "";
  search.value = "";
  entityPage.value = 1;
}

onMounted(() => {
  const saved = localStorage.getItem("usageAutoRefresh");
  if (saved !== null) autoRefresh.value = saved === "true";
  const requested = route.query.tab as Tab;
  if (tabs.some(([id]) => id === requested)) tab.value = requested;
  connectStream();
  liveWatchdog = window.setInterval(() => {
    if (!stream || stream.readyState === EventSource.CLOSED) connectStream();
  }, 5_000);
  refreshTopologyLayout();
  window.addEventListener("resize", refreshTopologyLayout);
  topologyResizeObserver = new ResizeObserver(() => measureTopologyHeight());
  if (topologyPanelRef.value)
    topologyResizeObserver.observe(topologyPanelRef.value);
});
onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (searchTimer) window.clearTimeout(searchTimer);
  if (requestSearchTimer) window.clearTimeout(requestSearchTimer);
  if (liveWatchdog) window.clearInterval(liveWatchdog);
  stream?.close();
  window.removeEventListener("resize", refreshTopologyLayout);
  topologyResizeObserver?.disconnect();
});
watch(autoRefresh, (value) =>
  localStorage.setItem("usageAutoRefresh", String(value)),
);
watch(
  () => route.query.tab,
  (value) => {
    if (tabs.some(([id]) => id === value)) tab.value = value as Tab;
  },
);
watch(tab, (value) => {
  if (value === "overview") void nextTick(syncTopologyObserver);
  entityFilters.value = { ...EMPTY_ENTITY_FILTERS };
  searchInput.value = "";
  search.value = "";
  entityPage.value = 1;
});
watch(
  entityFilters,
  () => {
    entityPage.value = 1;
  },
  { deep: true },
);
watch(
  filters,
  () => {
    requestPage.value = 1;
  },
  { deep: true },
);
watch(
  [autoRefresh, tab],
  ([enabled, active]) => {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshCountdown.value = REFRESH_INTERVAL_SEC;
    refreshTimer =
      enabled && active !== "overview"
        ? window.setInterval(() => {
            if (refreshCountdown.value <= 1) {
              refreshCountdown.value = REFRESH_INTERVAL_SEC;
              refreshKey.value++;
            } else {
              refreshCountdown.value--;
            }
          }, 1_000)
        : undefined;
  },
  { immediate: true },
);
</script>

<template>
  <main class="theme-v2 min-w-0 space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div class="max-w-full overflow-x-auto">
        <TabSwitcher
          :model-value="tab"
          :options="tabOptions"
          class="min-w-max"
          @update:model-value="changeTab($event)"
        />
      </div>
      <div v-if="hasHeaderActions" class="flex flex-wrap items-center gap-2">
        <Select
          v-if="hasPeriod"
          :model-value="period"
          :options="periodOptions"
          class="w-auto min-w-28 font-normal text-foreground"
          aria-label="Usage period"
          @update:model-value="changePeriod(String($event) as UsagePeriod)"
        /><template v-if="tab !== 'overview'"
          ><Button
            variant="outline"
            size="icon"
            class="relative"
            :class="autoRefresh ? 'text-primary' : 'text-muted-foreground'"
            :title="
              autoRefresh
                ? `Auto-refresh in ${refreshCountdown}s`
                : 'Enable auto-refresh'
            "
            :aria-label="
              autoRefresh
                ? `Auto-refresh in ${refreshCountdown} seconds`
                : 'Enable auto-refresh'
            "
            @click="autoRefresh = !autoRefresh"
            ><Clock class="size-4" /><span
              v-if="autoRefresh"
              class="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-[9px] leading-4 text-primary-foreground"
              >{{ refreshCountdown }}s</span
            ></Button
          ><Button
            variant="outline"
            size="icon"
            title="Refresh usage data"
            aria-label="Refresh usage data"
            :disabled="refreshing"
            @click="refresh"
            ><RefreshCw
              :class="['size-4', refreshing && 'animate-spin']" /></Button
        ></template>
      </div>
    </div>

    <div
      :key="tab"
      class="animate-in fade-in slide-in-from-bottom-1 space-y-6 duration-200 motion-reduce:animate-none"
    >
      <template v-if="tab === 'overview'">
        <UsageOverviewPanel
          :overview="overviewData.data.value"
          :loading="overviewData.isFetching.value"
          :period-label="overviewPeriodLabel"
        />
        <div
          ref="topologyPanelRef"
          class="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"
        >
          <ProviderTopology
            :providers="topologyProviders"
            :height="panelHeight"
            :active-requests="live.activeRequests"
            :last-provider="lastProvider"
            :error-provider="errorProvider"
          /><Card
            :style="panelHeight ? { height: `${panelHeight}px` } : undefined"
            class="max-h-[480px] overflow-auto p-5 lg:max-h-none"
            ><h2 class="text-sm font-semibold">Recent Requests</h2>
            <div v-if="live.recentRequests.length" class="mt-3 divide-y">
              <div
                v-for="(entry, index) in live.recentRequests"
                :key="`${entry.timestamp}-${index}`"
                class="flex items-center gap-3 py-2 text-xs"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate font-mono">
                    {{ entry.displayModel || entry.model }}
                  </p>
                  <p class="mt-0.5 text-muted-foreground">
                    {{ number(entry.promptTokens - entry.cachedTokens) }} in ·
                    {{ number(entry.cachedTokens) }} cached ·
                    {{ number(entry.completionTokens) }} out
                  </p>
                </div>
                <span
                  class="shrink-0"
                  :class="
                    okay(entry.status) ? 'text-success' : 'text-destructive'
                  "
                  >{{ relative(entry.timestamp) }}</span
                ><Button
                  size="icon"
                  variant="ghost"
                  title="View details"
                  aria-label="View details"
                  @click="openLiveRequest(entry)"
                  ><Eye class="size-4"
                /></Button>
              </div>
            </div>
            <p
              v-else
              class="flex h-40 items-center justify-center text-sm text-muted-foreground"
            >
              No requests yet.
            </p></Card
          >
        </div>
        <!-- Last on purpose: the list is paginated but can still be very long. -->
        <UsageModelsTable :period="overviewPeriod" :refresh-key="refreshKey" />
      </template>

      <template v-else-if="tab === 'details'">
        <UsageTrendChart
          title="Traffic, last 7 days"
          description="Tokens per day, split by provider. Use the filters below to narrow the request list."
          :trend="requestsTrend.data.value"
          :loading="requestsTrend.isFetching.value"
        />
        <Card class="space-y-3 p-4">
          <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div class="relative min-w-0 flex-1">
              <Search
                class="size-4 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                :value="requestSearchInput"
                class="h-9 w-full min-w-0 rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                placeholder="Search model or provider..."
                aria-label="Search requests"
                @input="changeRequestSearch"
              />
            </div>
            <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Combobox
                v-model="filters.provider"
                :options="providerFilterOptions"
                :loading="providerOptions.isPending.value"
                placeholder="Provider"
                empty-text="No providers available"
                class="col-span-2 sm:w-48"
              />
              <Select
                v-model="filters.outcome"
                :options="outcomeOptions"
                class="col-span-2 sm:w-40"
                aria-label="Filter by outcome"
              />
            </div>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
            <label
              class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
              ><span class="w-10 shrink-0">From</span
              ><input
                v-model="filters.startDate"
                type="datetime-local"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            /></label>
            <label
              class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
              ><span class="w-10 shrink-0">To</span
              ><input
                v-model="filters.endDate"
                type="datetime-local"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            /></label>
            <Button
              variant="outline"
              class="lg:ml-auto"
              :disabled="!hasRequestFilters"
              @click="clearFilters"
              >Clear filters</Button
            >
          </div>
        </Card>
        <DataTable
          :loading="requests.isPending.value"
          :empty="
            !requests.isPending.value && !(requestData?.details || []).length
          "
          :columns="[
            'Timestamp',
            'Model',
            'Provider',
            'IP',
            'Input',
            'Cached',
            'Output',
            'Status',
            'Latency',
            'Tokens/s',
            'Thinking / Tools',
            '',
          ]"
          empty-title="No request details found"
          empty-description="Change the filters or route a request through the gateway."
          ><tr
            v-for="record in requestData?.details || []"
            :key="record.id"
            class="hover:bg-muted/50"
          >
            <td class="px-3 py-2.25 text-xs text-muted-foreground">
              <span class="usage-cell">{{ relative(record.timestamp) }}</span>
            </td>
            <td class="max-w-[220px] px-3 py-2.25 font-mono text-xs">
              <span class="usage-cell"
                ><span
                  class="block"
                  :title="record.displayModel || record.model || ''"
                  >{{ record.displayModel || record.model || "—" }}</span
                ><span
                  v-if="record.comboName"
                  class="mt-0.5 block text-[10px] text-muted-foreground"
                  >Combo: {{ record.comboName }}</span
                ></span
              >
            </td>
            <td class="max-w-[140px] px-3 py-2.25 text-xs">
              <span
                class="usage-cell"
                :title="displayName(record.provider || '')"
                >{{ displayName(record.provider || "") }}</span
              >
            </td>
            <td
              class="max-w-[140px] px-3 py-2.25 font-mono text-xs text-muted-foreground"
            >
              <span class="usage-cell" :title="record.clientIp || ''">{{
                record.clientIp || "—"
              }}</span>
            </td>
            <td class="px-3 py-2.25 text-right font-mono text-xs">
              <span class="usage-cell">{{ number(inputTokens(record)) }}</span>
            </td>
            <td class="px-3 py-2.25 text-right font-mono text-xs">
              <span class="usage-cell">{{
                cachedTokens(record) ? number(cachedTokens(record)) : "—"
              }}</span>
            </td>
            <td class="px-3 py-2.25 text-right font-mono text-xs">
              <span class="usage-cell">{{ number(outputTokens(record)) }}</span>
            </td>
            <td class="px-3 py-2.25 text-xs">
              <Badge
                :variant="okay(record.status) ? 'success' : 'destructive'"
                class="max-w-[8rem] truncate rounded-[5px]"
                :title="record.status || 'unknown'"
                >{{ record.status || "unknown" }}</Badge
              >
            </td>
            <td class="px-3 py-2.25 font-mono text-xs text-muted-foreground">
              <span class="usage-cell"
                >{{ record.latency?.ttft || 0 }} /
                {{ record.latency?.total || 0 }}ms</span
              >
            </td>
            <td class="px-3 py-2.25 text-right font-mono text-xs">
              <span class="usage-cell">{{
                tokensPerSecond(record) != null
                  ? `${tokensPerSecond(record)} t/s`
                  : "—"
              }}</span>
            </td>
            <td
              class="max-w-[180px] px-3 py-2.25 text-xs text-muted-foreground"
            >
              <span class="usage-cell" :title="activityLabel(record)">{{
                activityLabel(record)
              }}</span>
            </td>
            <td class="px-3 py-2.25">
              <Button
                size="icon"
                variant="ghost"
                title="View details"
                aria-label="View details"
                @click="drawer = { type: 'request', value: record }"
                ><Eye class="size-4"
              /></Button>
            </td></tr
        ></DataTable>
        <div
          v-if="requestData?.pagination"
          class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span class="text-sm text-muted-foreground"
            >{{ requestData.pagination.totalItems }} requests</span
          >
          <div class="flex flex-wrap items-center gap-2">
            <Select
              v-model="requestPageSize"
              :options="requestPageSizeOptions"
              class="w-auto min-w-24"
              aria-label="Requests per page"
            /><Button
              variant="outline"
              :disabled="requestPage <= 1"
              @click="requestPage--"
              >Previous</Button
            ><span class="text-xs"
              >{{ requestPage }} /
              {{ requestData.pagination.totalPages || 1 }}</span
            ><Button
              variant="outline"
              :disabled="requestPage >= requestData.pagination.totalPages"
              @click="requestPage++"
              >Next</Button
            >
          </div>
        </div>
      </template>

      <template v-else>
        <UsageTrendChart
          :title="trendTitle"
          :description="`Top ${tabHeaderSubtitle}s over the selected period. The rest are grouped as Other.`"
          :trend="trend.data.value"
          :loading="trend.isFetching.value"
        />
        <Card class="space-y-3 p-4">
          <div
            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold">
                {{ tabHeaderTitle }}
              </h2>
              <p class="mt-0.5 text-xs text-muted-foreground">
                Breakdowns by {{ tabHeaderSubtitle }}.
              </p>
            </div>
            <Button
              variant="outline"
              class="shrink-0"
              :disabled="!hasEntityFilters"
              @click="clearEntityFilters"
              >Clear filters</Button
            >
          </div>
          <div
            class="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center"
          >
            <div class="relative min-w-0 sm:col-span-2 lg:w-72 lg:flex-none">
              <Search
                class="size-4 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                :value="searchInput"
                class="h-9 w-full min-w-0 rounded-md border border-input bg-background pl-9 pr-3 text-sm"
                :placeholder="tabHeaderPlaceholder"
                aria-label="Search"
                @input="changeSearch"
              />
            </div>
            <Select
              v-if="tab === 'accounts' || tab === 'models'"
              v-model="entityFilters.provider"
              :options="entityProviderOptions"
              class="lg:w-44"
              aria-label="Filter by provider"
            />
            <Select
              v-if="tab === 'api-keys'"
              v-model="entityFilters.status"
              :options="keyStatusOptions"
              class="lg:w-40"
              aria-label="Filter by key status"
            />
            <Select
              v-if="tab === 'api-keys'"
              v-model="entityFilters.visibility"
              :options="visibilityOptions"
              class="lg:w-44"
              aria-label="Filter by key visibility"
            />
            <Select
              v-if="tab === 'api-keys'"
              v-model="entityFilters.activity"
              :options="keyActivityOptions"
              class="lg:w-40"
              aria-label="Filter by usage"
            />
            <Select
              v-model="entityFilters.health"
              :options="healthOptions"
              class="lg:w-40"
              aria-label="Filter by errors"
            />
            <Select
              v-model="entityFilters.sort"
              :options="sortOptions"
              class="lg:ml-auto lg:w-44"
              aria-label="Sort by"
            />
          </div>
        </Card>
        <DataTable
          v-if="tab === 'providers'"
          :loading="providers.isPending.value"
          :empty="!(providers.data.value?.providers || []).length"
          :columns="['Provider', 'Tokens', 'Requests', 'Last used', '']"
          :empty-title="search ? 'No matching results' : 'No usage yet'"
          empty-description="Send traffic through the gateway to populate this view."
          ><tr
            v-for="row in providers.data.value?.providers || []"
            :key="row.id"
            class="hover:bg-muted/50"
          >
            <td class="max-w-[280px] px-3.75 py-[7.5px]">
              <span class="usage-cell"
                ><span class="block font-medium" :title="row.name">{{
                  row.name
                }}</span
                ><span
                  v-if="row.name !== row.id"
                  class="block font-mono text-[10px] text-muted-foreground"
                  >{{ row.id }}</span
                ></span
              >
            </td>
            <td class="px-3.75 py-2.25 text-right text-xs">
              <span class="usage-cell"
                ><span class="block font-mono">{{
                  number(row.usage.totalTokens)
                }}</span
                ><span class="block font-mono text-[10px] text-muted-foreground"
                  >{{ number(row.usage.promptTokens) }} in ·
                  {{ number(row.usage.completionTokens) }} out</span
                ></span
              >
            </td>
            <td class="px-3.75 py-2.25 text-right font-mono text-xs">
              <span class="usage-cell">{{ number(row.usage.requests) }}</span>
            </td>
            <td
              class="px-3.75 py-2.25 text-right text-xs text-muted-foreground"
            >
              <span class="usage-cell">{{ relative(row.usage.lastUsed) }}</span>
            </td>
            <td class="px-3.75 py-[7.5px]">
              <Button
                size="icon"
                variant="ghost"
                title="View details"
                aria-label="View details"
                @click="drawer = { type: 'provider', value: row }"
                ><Eye class="size-4"
              /></Button>
            </td></tr
        ></DataTable>
        <DataTable
          v-else-if="tab === 'api-keys'"
          :loading="keys.isPending.value"
          :empty="!(keys.data.value?.keys || []).length"
          :columns="['Name', 'Key', 'Tokens', 'Requests', 'Last used', '']"
          :empty-title="search ? 'No matching results' : 'No usage yet'"
          empty-description="Send traffic through the gateway to populate this view."
          ><tr
            v-for="row in keys.data.value?.keys || []"
            :key="row.id"
            class="hover:bg-muted/50"
            :class="row.isActive ? '' : 'opacity-60'"
          >
            <td class="max-w-[280px] px-3.75 py-[7.5px]">
              <span class="usage-cell"
                ><span class="font-medium" :title="row.name || ''">{{
                  row.name || "Unnamed key"
                }}</span
                ><span
                  v-if="!row.isActive"
                  class="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
                  >Paused</span
                ></span
              >
            </td>
            <td
              class="max-w-[200px] px-3.75 py-2.25 font-mono text-xs text-muted-foreground"
            >
              <span class="usage-cell" :title="row.key">{{ row.key }}</span>
            </td>
            <td class="px-3.75 py-2.25 text-right text-xs">
              <span class="usage-cell"
                ><span class="block font-mono">{{
                  number(row.usage.totalTokens)
                }}</span
                ><span class="block font-mono text-[10px] text-muted-foreground"
                  >{{ number(row.usage.promptTokens) }} in ·
                  {{ number(row.usage.completionTokens) }} out</span
                ></span
              >
            </td>
            <td class="px-3.75 py-2.25 text-right font-mono text-xs">
              <span class="usage-cell">{{ number(row.usage.requests) }}</span>
            </td>
            <td
              class="px-3.75 py-2.25 text-right text-xs text-muted-foreground"
            >
              <span class="usage-cell">{{ relative(row.usage.lastUsed) }}</span>
            </td>
            <td class="px-3.75 py-[7.5px]">
              <Button
                size="icon"
                variant="ghost"
                title="View details"
                aria-label="View details"
                @click="drawer = { type: 'key', value: row }"
                ><Eye class="size-4"
              /></Button>
            </td></tr
        ></DataTable>
        <DataTable
          v-else
          :loading="listLoading"
          :empty="!listRows.length"
          :columns="['Name', 'Tokens', 'Requests', 'Last used']"
          :empty-title="search ? 'No matching results' : 'No usage yet'"
          empty-description="Send traffic through the gateway to populate this view."
          ><tr v-for="row in listRows" :key="row.id" class="hover:bg-muted/50">
            <td class="max-w-[280px] px-3.75 py-[7.5px]">
              <span class="usage-cell"
                ><span
                  class="block font-medium"
                  :title="entityDisplay(row.name)"
                  >{{ entityDisplay(row.name) }}</span
                ><span
                  v-if="row.name !== entityDisplay(row.name)"
                  class="block truncate font-mono text-[10px] text-muted-foreground"
                  :title="row.id"
                  >{{ row.id }}</span
                ></span
              >
            </td>
            <td class="px-3.75 py-2.25 text-right text-xs">
              <span class="usage-cell"
                ><span class="block font-mono">{{
                  number(row.usage.totalTokens)
                }}</span
                ><span class="block font-mono text-[10px] text-muted-foreground"
                  >{{ number(row.usage.promptTokens) }} in ·
                  {{ number(row.usage.completionTokens) }} out</span
                ></span
              >
            </td>
            <td class="px-3.75 py-2.25 text-right font-mono text-xs">
              <span class="usage-cell">{{ number(row.usage.requests) }}</span>
            </td>
            <td
              class="px-3.75 py-2.25 text-right text-xs text-muted-foreground"
            >
              <span class="usage-cell">{{ relative(row.usage.lastUsed) }}</span>
            </td>
          </tr></DataTable
        >
        <div
          v-if="entityPagination"
          class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span class="text-sm text-muted-foreground"
            >{{ entityPagination.totalItems }} entries</span
          >
          <div class="flex flex-wrap items-center gap-2">
            <Select
              v-model="entityPageSize"
              :options="entityPageSizeOptions"
              class="w-auto min-w-24"
              aria-label="Entries per page"
            /><Button
              variant="outline"
              :disabled="entityPage <= 1"
              @click="entityPage--"
              >Previous</Button
            ><span class="text-xs"
              >{{ entityPage }} / {{ entityPagination.totalPages }}</span
            ><Button
              variant="outline"
              :disabled="entityPage >= entityPagination.totalPages"
              @click="entityPage++"
              >Next</Button
            >
          </div>
        </div>
      </template>
    </div>
    <EmptyState
      v-if="
        (tab === 'details' && requests.isError.value) ||
        (tab === 'providers' && providers.isError.value) ||
        (tab === 'api-keys' && keys.isError.value) ||
        (tab === 'accounts' && accounts.isError.value) ||
        (tab === 'models' && models.isError.value) ||
        (tab === 'combos' && combos.isError.value)
      "
      title="Usage data could not be loaded"
      description="Refresh the page or check the gateway connection."
    />
  </main>

  <Transition name="usage-drawer">
    <div
      v-if="drawer"
      class="theme-v2 fixed inset-0 z-50 flex justify-end bg-black/45"
      @click.self="drawer = null"
    >
      <aside
        class="h-full w-full max-w-3xl overflow-y-auto bg-background p-5 shadow-2xl sm:p-6"
      >
        <div class="flex items-start justify-between gap-4 border-b pb-4">
          <div class="min-w-0">
            <h2
              class="break-words text-lg font-semibold [overflow-wrap:anywhere]"
            >
              {{
                drawer.type === "request"
                  ? "Request Details"
                  : drawer.type === "provider"
                    ? drawer.value.name
                    : drawer.value.name || "API Key"
              }}
            </h2>
            <p class="mt-1 text-xs text-muted-foreground">
              {{
                drawer.type === "request"
                  ? date(drawer.value.timestamp)
                  : `Period: ${period}`
              }}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            title="Close details"
            aria-label="Close details"
            @click="drawer = null"
            ><X class="size-4"
          /></Button>
        </div>
        <template v-if="drawer.type === 'request'">
          <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-muted-foreground">Provider</dt>
              <dd class="mt-1">
                {{ displayName(drawer.value.provider || "") }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Model</dt>
              <dd class="mt-1 break-all font-mono text-xs">
                {{ drawer.value.model }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Client IP</dt>
              <dd class="mt-1 break-all font-mono text-xs">
                {{ drawer.value.clientIp || "—" }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Latency</dt>
              <dd class="mt-1 font-mono text-xs">
                TTFT {{ drawer.value.latency?.ttft || 0 }}ms / Total
                {{ drawer.value.latency?.total || 0 }}ms
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">Tokens/s</dt>
              <dd class="mt-1 font-mono text-xs">
                {{
                  tokensPerSecond(drawer.value) != null
                    ? `${tokensPerSecond(drawer.value)} t/s`
                    : "—"
                }}
              </dd>
            </div>
          </dl>
          <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card class="p-3"
              ><p class="text-xs text-muted-foreground">Thinking tokens</p>
              <p class="mt-1 font-mono text-base sm:text-lg">
                {{
                  reasoningTokens(drawer.value) === null
                    ? "Not reported"
                    : number(reasoningTokens(drawer.value))
                }}
              </p></Card
            >
            <Card class="p-3"
              ><p class="text-xs text-muted-foreground">Thinking blocks</p>
              <p class="mt-1 font-mono text-base sm:text-lg">
                {{
                  thinkingBlocks(drawer.value) === null
                    ? "Not available"
                    : number(thinkingBlocks(drawer.value))
                }}
              </p></Card
            >
            <Card class="p-3"
              ><p class="text-xs text-muted-foreground">Tool calls</p>
              <p class="mt-1 font-mono text-base sm:text-lg">
                {{
                  toolCalls(drawer.value) === null
                    ? "Not available"
                    : number(toolCalls(drawer.value))
                }}
              </p></Card
            >
          </div>
          <div class="mt-6 space-y-4">
            <details open>
              <summary class="cursor-pointer text-sm font-semibold">
                1. Client Request (Input)
              </summary>
              <pre
                class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs"
                >{{ JSON.stringify(drawer.value.request, null, 2) }}</pre>
            </details>
            <details
              v-if="
                drawer.value.requestHeaders &&
                Object.keys(drawer.value.requestHeaders).length
              "
            >
              <summary class="cursor-pointer text-sm font-semibold">
                2. Request Headers
              </summary>
              <pre
                class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs"
                >{{
                  JSON.stringify(drawer.value.requestHeaders, null, 2)
                }}</pre>
            </details>
            <details v-if="drawer.value.providerRequest">
              <summary class="cursor-pointer text-sm font-semibold">
                3. Provider Request (Translated)
              </summary>
              <pre
                class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs"
                >{{
                  JSON.stringify(drawer.value.providerRequest, null, 2)
                }}</pre>
            </details>
            <details v-if="drawer.value.providerResponse">
              <summary class="cursor-pointer text-sm font-semibold">
                4. Provider Response (Raw)
              </summary>
              <pre
                class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs"
                >{{
                  JSON.stringify(drawer.value.providerResponse, null, 2)
                }}</pre>
            </details>
            <details
              v-if="
                drawer.value.responseHeaders &&
                Object.keys(drawer.value.responseHeaders).length
              "
            >
              <summary class="cursor-pointer text-sm font-semibold">
                5. Response Headers
              </summary>
              <pre
                class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs"
                >{{
                  JSON.stringify(drawer.value.responseHeaders, null, 2)
                }}</pre>
            </details>
            <details open>
              <summary class="cursor-pointer text-sm font-semibold">
                6. Client Response (Final)
              </summary>
              <pre
                class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs"
                >{{ drawer.value.response?.content || "[No content]" }}</pre>
            </details>
          </div>
        </template>
        <template v-else>
          <div
            v-if="
              drawer.type === 'provider'
                ? providerDetail.isLoading.value
                : keyDetail.isLoading.value
            "
            class="py-16 text-center text-sm text-muted-foreground"
          >
            Loading usage...
          </div>
          <template v-else-if="!detail.totalRequests">
            <div
              class="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground"
            >
              <span class="material-symbols-outlined text-[28px]"
                >bar_chart</span
              >
              <p>No usage recorded for this period.</p>
            </div>
          </template>
          <div v-else class="mt-5 space-y-6">
            <!-- Summary -->
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Card class="p-3"
                ><p class="text-[10px] font-medium text-muted-foreground">
                  Requests
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                  {{ number(detail.totalRequests) }}
                </p></Card
              >
              <Card class="p-3"
                ><p class="text-[10px] font-medium text-muted-foreground">
                  Total tokens
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                  {{ number(detail.totalTokens) }}
                </p></Card
              >
              <Card class="p-3"
                ><p class="text-[10px] font-medium text-muted-foreground">
                  Input
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                  {{ number(detail.totalPromptTokens) }}
                </p></Card
              >
              <Card class="p-3"
                ><p class="text-[10px] font-medium text-muted-foreground">
                  Output
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                  {{ number(detail.totalCompletionTokens) }}
                </p></Card
              >
              <Card class="p-3"
                ><p class="text-[10px] font-medium text-muted-foreground">
                  Cached
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                  {{ number(detail.totalCachedTokens) }}
                </p></Card
              >
              <Card class="p-3"
                ><p class="text-[10px] font-medium text-muted-foreground">
                  Cost
                </p>
                <p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
                  {{ currency(detail.totalCost) }}
                </p></Card
              >
            </div>
            <div
              class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground"
            >
              <span
                ><span class="font-medium text-foreground">Unique IPs:</span>
                {{ number(detail.uniqueIps) }}</span
              >
              <span
                ><span class="font-medium text-foreground">Last used:</span>
                {{
                  detail.lastUsed ? relative(detail.lastUsed) : "Never"
                }}</span
              >
            </div>

            <!-- Highlights -->
            <div
              v-if="
                detail.highlights?.mostRequestedModel ||
                detail.highlights?.mostTokensModel
              "
              class="grid gap-3 sm:grid-cols-2"
            >
              <Card v-if="detail.highlights?.mostRequestedModel" class="p-3">
                <p class="text-[10px] font-medium text-muted-foreground">
                  Most requested model
                </p>
                <p
                  class="mt-1 truncate text-sm font-medium"
                  :title="detail.highlights.mostRequestedModel.model || ''"
                >
                  {{ detail.highlights.mostRequestedModel.model || "—" }}
                </p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ number(detail.highlights.mostRequestedModel.requests) }}
                  requests ·
                  {{ number(detail.highlights.mostRequestedModel.totalTokens) }}
                  tokens
                </p>
              </Card>
              <Card v-if="detail.highlights?.mostTokensModel" class="p-3">
                <p class="text-[10px] font-medium text-muted-foreground">
                  Most tokens model
                </p>
                <p
                  class="mt-1 truncate text-sm font-medium"
                  :title="detail.highlights.mostTokensModel.model || ''"
                >
                  {{ detail.highlights.mostTokensModel.model || "—" }}
                </p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ number(detail.highlights.mostTokensModel.totalTokens) }}
                  tokens ·
                  {{ number(detail.highlights.mostTokensModel.requests) }}
                  requests
                </p>
              </Card>
            </div>

            <!-- Models -->
            <section v-if="detail.byModel?.length">
              <h3 class="mb-2 text-xs font-semibold text-muted-foreground">
                Models
              </h3>
              <div class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[640px] text-left text-xs">
                  <thead
                    class="border-b bg-muted/60 text-[10px] text-muted-foreground"
                  >
                    <tr>
                      <th class="font-semibold px-3 py-2.5">Model</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Requests
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Input
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Output
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Cached
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">Cost</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Last used
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr
                      v-for="(row, index) in detail.byModel"
                      :key="`${row.rawModel}-${index}`"
                      class="hover:bg-muted/50"
                    >
                      <td class="max-w-[220px] px-2.25 py-1.5">
                        <span
                          class="block truncate font-mono"
                          :title="row.rawModel || ''"
                          >{{ row.rawModel || "—" }}</span
                        ><span
                          v-if="row.provider"
                          class="block text-[10px] text-muted-foreground"
                          >{{ displayName(row.provider) }}</span
                        >
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowRequests(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowIn(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowOut(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(row.cachedTokens || 0) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ currency(rowCost(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right text-muted-foreground"
                      >
                        {{ row.lastUsed ? relative(row.lastUsed) : "—" }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- Accounts (provider drawer) -->
            <section
              v-if="drawer.type === 'provider' && detail.byAccount?.length"
            >
              <h3 class="mb-2 text-xs font-semibold text-muted-foreground">
                Accounts
              </h3>
              <div class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[560px] text-left text-xs">
                  <thead
                    class="border-b bg-muted/60 text-[10px] text-muted-foreground"
                  >
                    <tr>
                      <th class="font-semibold px-3 py-2.5">Account</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Requests
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Input
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Output
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">Cost</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Last used
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr
                      v-for="(row, index) in detail.byAccount"
                      :key="`account-${row.id}-${index}`"
                      class="hover:bg-muted/50"
                    >
                      <td class="max-w-[220px] px-2.25 py-1.5">
                        <span
                          class="block truncate"
                          :title="accountLabel(String(row.id))"
                          >{{ accountLabel(String(row.id)) }}</span
                        ><span
                          class="block font-mono text-[10px] text-muted-foreground"
                          >{{ row.id }}</span
                        >
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowRequests(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowIn(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowOut(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ currency(rowCost(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right text-muted-foreground"
                      >
                        {{ row.lastUsed ? relative(row.lastUsed) : "—" }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- API keys (provider drawer) -->
            <section
              v-if="drawer.type === 'provider' && detail.byApiKey?.length"
            >
              <h3 class="mb-2 text-xs font-semibold text-muted-foreground">
                API keys
              </h3>
              <div class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[560px] text-left text-xs">
                  <thead
                    class="border-b bg-muted/60 text-[10px] text-muted-foreground"
                  >
                    <tr>
                      <th class="font-semibold px-3 py-2.5">Key</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Requests
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Input
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Output
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">Cost</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Last used
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr
                      v-for="(row, index) in detail.byApiKey"
                      :key="`key-${row.id}-${index}`"
                      class="hover:bg-muted/50"
                    >
                      <td
                        class="px-2.25 py-1.5 font-mono"
                        :title="String(row.id)"
                      >
                        {{ keyLabel(String(row.id)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowRequests(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowIn(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowOut(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ currency(rowCost(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right text-muted-foreground"
                      >
                        {{ row.lastUsed ? relative(row.lastUsed) : "—" }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- Providers (key drawer) -->
            <section v-if="drawer.type === 'key' && detail.byProvider?.length">
              <h3 class="mb-2 text-xs font-semibold text-muted-foreground">
                Providers
              </h3>
              <div class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[560px] text-left text-xs">
                  <thead
                    class="border-b bg-muted/60 text-[10px] text-muted-foreground"
                  >
                    <tr>
                      <th class="font-semibold px-3 py-2.5">Provider</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Requests
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Input
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Output
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">Cost</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Last used
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr
                      v-for="(row, index) in detail.byProvider"
                      :key="`provider-${row.id}-${index}`"
                      class="hover:bg-muted/50"
                    >
                      <td class="px-2.25 py-1.5">
                        {{ displayName(row.id || row.provider) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowRequests(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowIn(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowOut(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ currency(rowCost(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right text-muted-foreground"
                      >
                        {{ row.lastUsed ? relative(row.lastUsed) : "—" }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- Client IPs -->
            <section v-if="detail.byIp?.length">
              <h3 class="mb-2 text-xs font-semibold text-muted-foreground">
                Client IPs
              </h3>
              <div class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[480px] text-left text-xs">
                  <thead
                    class="border-b bg-muted/60 text-[10px] text-muted-foreground"
                  >
                    <tr>
                      <th class="font-semibold px-3 py-2.5">IP</th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Requests
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Input
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        Output
                      </th>
                      <th class="font-semibold px-3 py-2.5 text-right">
                        <button
                          type="button"
                          class="ml-auto flex items-center gap-1 transition-colors hover:text-foreground"
                          :aria-sort="
                            ipSortDir === 'desc'
                              ? 'descending'
                              : 'ascending'
                          "
                          :title="
                            ipSortDir === 'desc'
                              ? 'Newest first — click for oldest first'
                              : 'Oldest first — click for newest first'
                          "
                          @click="toggleIpSort"
                        >
                          Last used
                          <ChevronDown
                            v-if="ipSortDir === 'desc'"
                            class="size-3.5"
                          />
                          <ChevronUp v-else class="size-3.5" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr
                      v-for="(row, index) in sortedByIp"
                      :key="`ip-${row.ip}-${index}`"
                      class="hover:bg-muted/50"
                    >
                      <td class="px-2.25 py-1.5 font-mono">
                        {{ row.ip || "—" }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowRequests(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowIn(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowOut(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right text-muted-foreground"
                      >
                        {{ row.lastUsed ? relative(row.lastUsed) : "—" }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- Recent requests -->
            <section v-if="detail.recentRequests?.length">
              <h3 class="mb-2 text-xs font-semibold text-muted-foreground">
                Recent requests
              </h3>
              <div class="overflow-x-auto rounded-lg border">
                <table class="w-full min-w-[640px] text-left text-xs">
                  <thead
                    class="border-b bg-muted/60 text-[10px] text-muted-foreground"
                  >
                    <tr>
                      <th class="font-semibold px-3 py-2.5">When</th>
                      <th class="font-semibold px-3 py-2.5">Model</th>
                      <th class="font-semibold px-3 py-2.5">Provider</th>
                      <th class="font-semibold px-3 py-2.5 text-right">In</th>
                      <th class="font-semibold px-3 py-2.5 text-right">Out</th>
                      <th class="font-semibold px-3 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    <tr
                      v-for="(row, index) in detail.recentRequests"
                      :key="`recent-${index}-${row.timestamp}`"
                      class="hover:bg-muted/50"
                    >
                      <td
                        class="whitespace-nowrap px-2.25 py-1.5 text-muted-foreground"
                        :title="row.timestamp ? date(row.timestamp) : ''"
                      >
                        {{ row.timestamp ? relative(row.timestamp) : "—" }}
                      </td>
                      <td class="max-w-[200px] px-2.25 py-1.5 font-mono">
                        <span class="block truncate" :title="row.model || ''">{{
                          row.model || "—"
                        }}</span>
                      </td>
                      <td class="px-2.25 py-1.5">
                        {{ row.provider ? displayName(row.provider) : "—" }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowIn(row)) }}
                      </td>
                      <td
                        class="px-2.25 py-1.5 text-right font-mono tabular-nums"
                      >
                        {{ number(rowOut(row)) }}
                      </td>
                      <td class="px-2.25 py-1.5">
                        <Badge
                          :variant="
                            okay(row.status) ? 'success' : 'destructive'
                          "
                          >{{ row.status || "unknown" }}</Badge
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </template>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.usage-cell {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.usage-drawer-enter-active,
.usage-drawer-leave-active {
  transition: opacity 180ms ease;
}

.usage-drawer-enter-from,
.usage-drawer-leave-to {
  opacity: 0;
}

.usage-drawer-enter-active aside,
.usage-drawer-leave-active aside {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.usage-drawer-enter-from aside,
.usage-drawer-leave-to aside {
  transform: translateX(100%);
}
</style>
