<script setup lang="ts">
// Port of v1 usage/components/ProviderLimits (the Quota Tracker page).
// Data path matches v1: /api/providers/client for the paginated account list and
// /api/usage/:connectionId for per-account quota, parsed client-side by lib/quota.
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { api } from "@/lib/api";
import {
  ACCOUNT_FILTER_OPTIONS,
  ACCOUNT_PAGE_SIZE_MAX,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  AUTO_REFRESH_STORAGE_KEY,
  CLAUDE_REFRESH_INTERVAL_MS,
  CONNECTIONS_PAGE_SIZE,
  DEPLETED_QUOTA_THRESHOLD,
  REFRESH_INTERVAL_MS,
  QUOTA_SORT_OPTIONS,
  calculatePercentage,
  filterQuotasByVisibility,
  formatResetTime,
  getConnectionLabel,
  getConnectionSecondaryLabel,
  getConnectionsEmptyMessage,
  getConnectionsPaginationSummary,
  getHiddenQuotaRows,
  getQuotaVisibilityKey,
  groupConnectionsByProvider,
  parseQuotaData,
  sortVisibleConnections,
  type NormalizedQuotaRow,
  type Pagination,
  type QuotaConnection,
  type QuotaEntry,
  type Totals,
} from "@/lib/quota";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import Card from "@/components/ui/card.vue";
import Select from "@/components/ui/select.vue";
import Toggle from "@/components/ui/toggle.vue";
import ProviderLogo from "@/components/app/ProviderLogo.vue";
import QuotaTable from "@/components/usage/QuotaTable.vue";
import EditConnectionModal from "@/components/connections/EditConnectionModal.vue";

const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
  autoclaw: "autoclawAutoClaim",
  "codebuddy-intl-cli": "codebuddyIntlCliDailyProbe",
};
const AUTO_PING_TOOLTIPS: Record<string, string> = {
  claude:
    "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.",
  codex:
    "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota.",
  autoclaw: "Automatically claims the daily check-in reward once per day.",
  "codebuddy-intl-cli":
    "Automatically sends one tiny request per day so the account burns credit.",
};
const CODEBUDDY_INTL_PROVIDERS = ["codebuddy-intl-cli"];

const connections = ref<QuotaConnection[]>([]);
const quotaData = ref<Record<string, QuotaEntry>>({});
const loading = ref<Record<string, boolean>>({});
const errors = ref<Record<string, string | null>>({});
const autoRefresh = ref(true);
const autoPingMaps = ref<Record<string, Record<string, boolean>>>({
  claude: {},
  codex: {},
  autoclaw: {},
});
// codebuddy-intl-cli: name of the quota meter (e.g. "Monthly") to drain first
// before each account falls back to its other meters. Null = feature disabled.
const codebuddyPriorityMeter = ref<string | null>(null);
const codebuddyPrioritySaving = ref(false);
const refreshingAll = ref(false);
const countdown = ref(60);
const connectionsLoading = ref(true);
const deletingId = ref<string | null>(null);
const togglingId = ref<string | null>(null);
const resettingLimitId = ref<string | null>(null);
const resetConfirmState = ref<{
  connection: QuotaConnection;
  resetCreditCount: number;
} | null>(null);
const resetCreditsState = ref<{
  connection: QuotaConnection;
  loading: boolean;
  error: string | null;
  data: Record<string, any> | null;
} | null>(null);
const showEditModal = ref(false);
const selectedConnection = ref<QuotaConnection | null>(null);
const proxyPools = ref<Array<{ id: string; name: string }>>([]);
const providerFilter = ref("all");
const providerOptions = ref<string[]>([]);
const accountFilter = ref("all");
const quotaSortMode = ref("default");
const quotaVisibility = ref<Record<string, { hidden?: string[] }>>({});
const expiringFirst = ref(false);
const providerMenuOpen = ref(false);
const cardMenuOpenId = ref<string | null>(null);
const bulkToggling = ref(false);
const page = ref(1);
const pageSize = ref(500);
const customPageSizeInput = ref(String(CONNECTIONS_PAGE_SIZE));
const pagination = reactive<Pagination>({
  page: 1,
  pageSize: CONNECTIONS_PAGE_SIZE,
  total: 0,
  totalPages: 1,
});
const totals = reactive<Totals>({
  eligibleConnections: 0,
  providerFilteredConnections: 0,
});
const hasHydratedAutoRefresh = ref(false);
const tickCount = ref(0);

// Mirrors v1's PROVIDER_MODELS ordering source: model id → index per provider.
const modelOrder = ref<Map<string, Map<string, number>>>(new Map());

let intervalId: number | undefined;
let countdownId: number | undefined;

function getCodexResetCreditCount(quota: QuotaEntry | undefined) {
  const value = (quota?.raw as Record<string, any> | undefined)?.resetCredits
    ?.availableCount;
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

async function loadModelOrder() {
  try {
    const catalog = await api.models.list();
    const map = new Map<string, Map<string, number>>();
    for (const model of catalog.data || []) {
      const separator = model.id.indexOf("/");
      if (separator <= 0) continue;
      const provider = model.id.slice(0, separator);
      const id = model.id.slice(separator + 1);
      if (!map.has(provider)) map.set(provider, new Map());
      const inner = map.get(provider)!;
      if (!inner.has(id)) inner.set(id, inner.size);
    }
    modelOrder.value = map;
  } catch {
    /* ordering falls back to server order */
  }
}

async function fetchConnections(targetPage = page.value) {
  try {
    const data = (await api.providers.client({
      page: targetPage,
      pageSize: pageSize.value,
      accountStatus: accountFilter.value,
      sort: "priority",
      ...(providerFilter.value !== "all"
        ? { provider: providerFilter.value }
        : {}),
    })) as {
      connections?: QuotaConnection[];
      providerOptions?: string[];
      pagination?: Pagination;
      totals?: Totals;
    };
    const connectionList = data.connections || [];
    connections.value = connectionList;
    providerOptions.value = data.providerOptions || [];
    Object.assign(
      pagination,
      data.pagination || {
        page: 1,
        pageSize: pageSize.value,
        total: 0,
        totalPages: 1,
      },
    );
    Object.assign(
      totals,
      data.totals || {
        eligibleConnections: connectionList.length,
        providerFilteredConnections: connectionList.length,
      },
    );
    page.value = data.pagination?.page || targetPage;
    return connectionList;
  } catch {
    connections.value = [];
    providerOptions.value = [];
    Object.assign(pagination, {
      page: 1,
      pageSize: pageSize.value,
      total: 0,
      totalPages: 1,
    });
    Object.assign(totals, {
      eligibleConnections: 0,
      providerFilteredConnections: 0,
    });
    return [];
  }
}

async function fetchQuota(connectionId: string, provider: string) {
  loading.value = { ...loading.value, [connectionId]: true };
  errors.value = { ...errors.value, [connectionId]: null };
  try {
    const data = await api.usage
      .byConnection(connectionId)
      .catch(async (error: unknown) => {
        const status = (error as { status?: number }).status;
        if (status === 404) return null;
        if (status === 401) {
          const payload = (error as { payload?: Record<string, unknown> })
            .payload;
          const message = (payload?.error as string) || "Unauthorized";
          const entry: QuotaEntry = { quotas: [], message };
          quotaData.value = { ...quotaData.value, [connectionId]: entry };
          return null;
        }
        throw error;
      });
    if (data === null) return;
    const order = modelOrder.value.get(provider);
    const entry: QuotaEntry = {
      quotas: parseQuotaData(provider, data, order),
      plan: ((data as Record<string, any>).plan as string) || null,
      message: ((data as Record<string, any>).message as string) || null,
      raw: data,
    };
    quotaData.value = { ...quotaData.value, [connectionId]: entry };
  } catch (error) {
    errors.value = {
      ...errors.value,
      [connectionId]:
        error instanceof Error ? error.message : "Failed to fetch quota",
    };
  } finally {
    loading.value = { ...loading.value, [connectionId]: false };
  }
}

async function refreshProvider(connectionId: string, provider: string) {
  await api.usage.refreshConnection(connectionId);
  await fetchQuota(connectionId, provider);
}

async function refreshAll(force = false) {
  if (refreshingAll.value) return;
  refreshingAll.value = true;
  countdown.value = 60;
  const tick = (tickCount.value += 1);
  const claudeEvery = Math.round(
    CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS,
  );
  const shouldFetch = (conn: QuotaConnection) =>
    force || conn.provider !== "claude" || tick % claudeEvery === 0;
  try {
    const visible = await fetchConnections(page.value);
    const loadingState: Record<string, boolean> = {};
    for (const conn of visible) loadingState[conn.id] = true;
    loading.value = loadingState;
    await Promise.all(
      visible
        .filter(shouldFetch)
        .map((conn) =>
          force
            ? refreshProvider(conn.id, conn.provider)
            : fetchQuota(conn.id, conn.provider),
        ),
    );
  } finally {
    refreshingAll.value = false;
  }
}

// Guard: the stale-refresh-on-visit runs once per page visit, not on every
// filter/pagination change that re-runs initializeData.
let staleRefreshDone = false;

async function initializeData() {
  connectionsLoading.value = true;
  const visible = await fetchConnections(page.value);
  connectionsLoading.value = false;
  const loadingState: Record<string, boolean> = {};
  for (const conn of visible) loadingState[conn.id] = true;
  loading.value = loadingState;
  // On first load, refresh any stale quota snapshots (missing, error, or past
  // due) so the bars show current numbers. Fresh snapshots skip the upstream
  // fetch, so this does not spam provider quota endpoints.
  if (!staleRefreshDone && visible.length) {
    staleRefreshDone = true;
    await api.usage
      .staleRefresh(visible.map((conn) => conn.id))
      .catch(() => ({ results: {} }));
  }
  await Promise.all(visible.map((conn) => fetchQuota(conn.id, conn.provider)));
}

async function handleResetCodexLimit(connectionId: string, provider: string) {
  if (provider !== "codex" || resettingLimitId.value) return;
  resettingLimitId.value = connectionId;
  errors.value = { ...errors.value, [connectionId]: null };
  try {
    await api.usage.codexResetCredits.post(connectionId);
    await refreshProvider(connectionId, provider);
  } catch (error) {
    errors.value = {
      ...errors.value,
      [connectionId]:
        error instanceof Error ? error.message : "Failed to reset Codex limit",
    };
  } finally {
    resettingLimitId.value = null;
  }
}

async function handleViewCodexResetCredits(connection: QuotaConnection) {
  resetCreditsState.value = {
    connection,
    loading: true,
    error: null,
    data: null,
  };
  try {
    const result = await api.usage.codexResetCredits.get(connection.id);
    const credits = Array.isArray(result.credits)
      ? [
          ...(result.credits as Array<
            Record<string, any> & { expiresAt?: string }
          >),
        ]
      : [];
    credits.sort((a, b) => {
      const aTime = a.expiresAt
        ? new Date(a.expiresAt).getTime()
        : Number.POSITIVE_INFINITY;
      const bTime = b.expiresAt
        ? new Date(b.expiresAt).getTime()
        : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
    resetCreditsState.value = {
      connection,
      loading: false,
      error: null,
      data: { ...result, credits },
    };
  } catch (error) {
    resetCreditsState.value = {
      connection,
      loading: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load Codex reset credits",
      data: null,
    };
  }
}

function formatCreditDate(value: string | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRemaining(value: string | undefined) {
  if (!value) return "N/A";
  const diffMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "N/A";
  if (diffMs <= 0) return "Expired";
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

async function handleDeleteConnection(id: string) {
  if (!window.confirm("Delete this connection?")) return;
  deletingId.value = id;
  try {
    await api.providers.remove(id);
    const nextQuota = { ...quotaData.value };
    delete nextQuota[id];
    quotaData.value = nextQuota;
    const nextLoading = { ...loading.value };
    delete nextLoading[id];
    loading.value = nextLoading;
    const nextErrors = { ...errors.value };
    delete nextErrors[id];
    errors.value = nextErrors;
    await fetchConnections(page.value);
  } finally {
    deletingId.value = null;
  }
}

async function handleToggleConnectionActive(id: string, isActive: boolean) {
  togglingId.value = id;
  try {
    await api.providers.update(id, { isActive });
    await fetchConnections(page.value);
  } finally {
    togglingId.value = null;
  }
}

async function handleUpdateConnection(updates: Record<string, unknown>) {
  if (!selectedConnection.value?.id) return;
  const connection = selectedConnection.value;
  await api.providers.update(connection.id, updates);
  await fetchConnections();
  showEditModal.value = false;
  selectedConnection.value = null;
  await fetchQuota(connection.id, connection.provider);
}

function autoPingLabel(provider: string): string {
  if (provider === "autoclaw") return "Auto-claim";
  if (CODEBUDDY_INTL_PROVIDERS.includes(provider)) return "Daily probe";
  return "Auto-ping";
}

async function toggleAutoPing(
  connectionId: string,
  provider: string,
  on: boolean,
) {
  const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
  if (!settingsKey) return;
  const previous = autoPingMaps.value;
  const nextProviderMap = {
    ...(autoPingMaps.value[provider] || {}),
    [connectionId]: on,
  };
  autoPingMaps.value = { ...autoPingMaps.value, [provider]: nextProviderMap };
  try {
    const settings = await api.settings.get();
    const cfg = {
      ...((settings as Record<string, any>)[settingsKey] || {}),
      connections: nextProviderMap,
    };
    await api.settings.update({ [settingsKey]: cfg });
  } catch {
    autoPingMaps.value = previous;
  }
}

async function updateQuotaVisibility(
  next: Record<string, { hidden?: string[] }>,
  previous: Record<string, { hidden?: string[] }>,
) {
  quotaVisibility.value = next;
  try {
    await api.settings.update({ quotaVisibility: next });
  } catch {
    quotaVisibility.value = previous;
  }
}

function handleHideQuota(provider: string, quota: NormalizedQuotaRow) {
  const key = getQuotaVisibilityKey(quota);
  if (!provider || !key) return;
  const previous = quotaVisibility.value;
  const providerVisibility = previous[provider] || {};
  const hidden = new Set(providerVisibility.hidden || []);
  hidden.add(key);
  updateQuotaVisibility(
    { ...previous, [provider]: { ...providerVisibility, hidden: [...hidden] } },
    previous,
  );
}

function handleShowQuota(provider: string, quota: NormalizedQuotaRow) {
  const key = getQuotaVisibilityKey(quota);
  if (!provider || !key) return;
  const previous = quotaVisibility.value;
  const providerVisibility = previous[provider] || {};
  const hidden = new Set(providerVisibility.hidden || []);
  hidden.delete(key);
  updateQuotaVisibility(
    { ...previous, [provider]: { ...providerVisibility, hidden: [...hidden] } },
    previous,
  );
}

function isConnectionDepleted(conn: QuotaConnection) {
  const quotas = quotaData.value[conn.id]?.quotas;
  if (!quotas?.length) return false;
  return quotas.some((quota) => {
    if (quota.balance !== undefined) return quota.balance <= 0;
    if (!quota.total || quota.total <= 0) return false;
    return (
      calculatePercentage(quota.used, quota.total) <= DEPLETED_QUOTA_THRESHOLD
    );
  });
}

async function bulkSetActive(targetIds: string[], isActive: boolean) {
  if (!targetIds.length || bulkToggling.value) return;
  bulkToggling.value = true;
  try {
    await Promise.all(
      targetIds.map((id) => api.providers.update(id, { isActive })),
    );
    await fetchConnections(page.value);
  } finally {
    bulkToggling.value = false;
  }
}

function handleDisableDepleted() {
  bulkSetActive(
    sortedConnections.value
      .filter((conn) => (conn.isActive ?? true) && isConnectionDepleted(conn))
      .map((conn) => conn.id),
    false,
  );
}

function handleEnableAvailable() {
  bulkSetActive(
    sortedConnections.value
      .filter((conn) => !(conn.isActive ?? true) && !isConnectionDepleted(conn))
      .map((conn) => conn.id),
    true,
  );
}

const sortedConnections = computed(() =>
  sortVisibleConnections(
    connections.value,
    quotaData.value,
    expiringFirst.value,
    providerFilter.value,
    quotaSortMode.value,
  ),
);
const providerGroups = computed(() =>
  groupConnectionsByProvider(sortedConnections.value),
);

// Union of meter names across every visible codebuddy-intl-cli connection.
// Fallback list keeps the dropdown useful even before quotas hydrate.
const codebuddyPriorityMeterOptions = computed<string[]>(() => {
  const names = new Set<string>();
  for (const conn of connections.value) {
    if (conn.provider !== "codebuddy-intl-cli") continue;
    const raw = quotaData.value[conn.id]?.raw as
      { quotas?: Record<string, unknown> } | undefined;
    const quotas = raw?.quotas;
    if (quotas && typeof quotas === "object") {
      for (const name of Object.keys(quotas)) names.add(name);
    }
  }
  if (names.size === 0) {
    ["Monthly", "Weekly", "Daily"].forEach((name) => names.add(name));
  }
  // Also surface the currently-selected meter so a stale name still round-trips.
  if (codebuddyPriorityMeter.value) names.add(codebuddyPriorityMeter.value);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
});

async function saveCodebuddyPriorityMeter(next: string) {
  const value = next.trim() === "" ? null : next.trim();
  codebuddyPrioritySaving.value = true;
  try {
    await api.settings.update({
      codebuddyIntlCli: { priorityMeter: value },
    });
    codebuddyPriorityMeter.value = value;
  } catch {
    /* keep prior value so the UI reflects on-disk state */
  } finally {
    codebuddyPrioritySaving.value = false;
  }
}
const selectedProviderLabel = computed(() =>
  providerFilter.value === "all" ? "All providers" : providerFilter.value,
);
const hasEligibleConnections = computed(() => totals.eligibleConnections > 0);
const hasVisibleConnections = computed(
  () => sortedConnections.value.length > 0,
);
const emptyState = computed(() =>
  getConnectionsEmptyMessage(totals, providerFilter.value, accountFilter.value),
);
const connectionsPageSummary = computed(() =>
  getConnectionsPaginationSummary(pagination),
);
const isCustomPageSize = computed(
  () => !ACCOUNT_PAGE_SIZE_OPTIONS.includes(pageSize.value),
);

function applyCustomPageSize() {
  const parsed = Number.parseInt(customPageSizeInput.value, 10);
  if (!Number.isFinite(parsed)) {
    customPageSizeInput.value = String(pageSize.value);
    return;
  }
  const next = Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsed));
  page.value = 1;
  pageSize.value = next;
  customPageSizeInput.value = String(next);
}

function stopTimers() {
  if (intervalId) {
    window.clearInterval(intervalId);
    intervalId = undefined;
  }
  if (countdownId) {
    window.clearInterval(countdownId);
    countdownId = undefined;
  }
}

function startTimers() {
  stopTimers();
  intervalId = window.setInterval(() => refreshAll(), REFRESH_INTERVAL_MS);
  countdownId = window.setInterval(() => {
    countdown.value = countdown.value <= 1 ? 60 : countdown.value - 1;
  }, 1000);
}

function onVisibilityChange() {
  if (document.hidden) stopTimers();
  else if (autoRefresh.value && hasHydratedAutoRefresh.value) startTimers();
}

onMounted(async () => {
  const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  autoRefresh.value = stored === null ? true : stored === "true";
  hasHydratedAutoRefresh.value = true;

  api.proxies
    .list()
    .then((pools) => {
      proxyPools.value = pools;
    })
    .catch(() => {});
  api.settings
    .get()
    .then((settings) => {
      const data = settings as Record<string, any>;
      autoPingMaps.value = {
        claude: data.claudeAutoPing?.connections || {},
        codex: data.codexAutoPing?.connections || {},
        autoclaw: data.autoclawAutoClaim?.connections || {},
        "codebuddy-intl-cli":
          data.codebuddyIntlCliDailyProbe?.connections || {},
      };
      quotaVisibility.value = data.quotaVisibility || {};
      const priorityRaw = data.codebuddyIntlCli?.priorityMeter;
      codebuddyPriorityMeter.value =
        typeof priorityRaw === "string" && priorityRaw.trim()
          ? priorityRaw.trim()
          : null;
    })
    .catch(() => {});

  await loadModelOrder();
  await initializeData();
  if (autoRefresh.value) startTimers();
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onUnmounted(() => {
  stopTimers();
  document.removeEventListener("visibilitychange", onVisibilityChange);
});

watch(autoRefresh, (value) => {
  if (!hasHydratedAutoRefresh.value) return;
  localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(value));
  if (value) startTimers();
  else stopTimers();
});

watch([page, pageSize, accountFilter, providerFilter], () => {
  initializeData();
});
</script>

<template>
  <div class="theme-v2 min-w-0 space-y-6">
    <!-- Header controls -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
      <div class="flex flex-wrap items-center gap-1.5">
        <!-- Provider filter menu -->
        <div class="relative">
          <button
            type="button"
            class="flex h-9 items-center justify-between gap-1.5 rounded-md border border-input bg-muted/40 px-2 text-xs transition-colors hover:bg-accent"
            aria-haspopup="menu"
            :aria-expanded="providerMenuOpen"
            title="Filter quota providers"
            @click="providerMenuOpen = !providerMenuOpen"
          >
            <span class="flex min-w-0 items-center gap-1.5">
              <span
                v-if="providerFilter === 'all'"
                class="material-symbols-outlined text-[14px] text-muted-foreground"
                >apps</span
              >
              <ProviderLogo
                v-else
                :provider="providerFilter"
                size="size-[18px]"
              />
              <span class="hidden truncate capitalize lg:inline">{{
                selectedProviderLabel
              }}</span>
            </span>
            <span
              class="material-symbols-outlined text-[14px] text-muted-foreground"
              >expand_more</span
            >
          </button>
          <template v-if="providerMenuOpen">
            <button
              type="button"
              class="fixed inset-0 z-30 bg-transparent"
              aria-label="Close provider filter"
              @click="providerMenuOpen = false"
            />
            <div
              class="absolute left-0 z-40 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1.5 shadow-lg sm:w-72"
            >
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors"
                :class="
                  providerFilter === 'all'
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-accent'
                "
                @click="
                  providerFilter = 'all';
                  page = 1;
                  providerMenuOpen = false;
                "
              >
                <span class="material-symbols-outlined text-[22px]">apps</span>
                <span class="font-medium">All providers</span>
                <span
                  v-if="providerFilter === 'all'"
                  class="material-symbols-outlined ml-auto text-[20px]"
                  >check</span
                >
              </button>
              <div class="my-1 h-px bg-border" />
              <div class="max-h-72 overflow-y-auto pr-1">
                <button
                  v-for="provider in providerOptions"
                  :key="provider"
                  type="button"
                  class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors"
                  :class="
                    providerFilter === provider
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-accent'
                  "
                  @click="
                    providerFilter = provider;
                    page = 1;
                    providerMenuOpen = false;
                  "
                >
                  <ProviderLogo :provider="provider" size="size-6" />
                  <span class="font-medium capitalize">{{ provider }}</span>
                  <span
                    v-if="providerFilter === provider"
                    class="material-symbols-outlined ml-auto text-[20px]"
                    >check</span
                  >
                </button>
              </div>
            </div>
          </template>
        </div>

        <Select
          v-model="accountFilter"
          :options="ACCOUNT_FILTER_OPTIONS"
          class="w-auto min-w-32"
          aria-label="Filter accounts by status"
          @update:model-value="page = 1"
        />

        <Select
          v-if="providerFilter === 'codex'"
          v-model="quotaSortMode"
          :options="QUOTA_SORT_OPTIONS"
          class="h-8 w-auto min-w-40 text-xs"
          aria-label="Sort Codex quotas by remaining"
        />

        <button
          type="button"
          :aria-pressed="expiringFirst"
          class="flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs transition-colors"
          :class="
            expiringFirst
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
              : 'border-border hover:bg-accent'
          "
          title="Sort accounts by earliest quota reset time"
          @click="expiringFirst = !expiringFirst"
        >
          <span class="material-symbols-outlined text-[14px]"
            >hourglass_top</span
          >
          <span class="hidden sm:inline">Expiring first</span>
        </button>

        <button
          type="button"
          :disabled="bulkToggling"
          class="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-red-500/30 px-2 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          title="Disable connections with depleted quota on the current page"
          @click="handleDisableDepleted"
        >
          <span class="material-symbols-outlined text-[14px]">block</span>
          <span class="hidden sm:inline">Turn off Empty</span>
        </button>

        <button
          type="button"
          :disabled="bulkToggling"
          class="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/30 px-2 text-xs text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
          title="Enable connections that still have quota on the current page"
          @click="handleEnableAvailable"
        >
          <span class="material-symbols-outlined text-[14px]"
            >check_circle</span
          >
          <span class="hidden sm:inline">Turn on Available</span>
        </button>

        <button
          type="button"
          class="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-xs transition-colors hover:bg-accent"
          :title="autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh'"
          @click="autoRefresh = !autoRefresh"
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="autoRefresh ? 'text-primary' : 'text-muted-foreground'"
          >
            {{ autoRefresh ? "toggle_on" : "toggle_off" }}
          </span>
          <span class="hidden sm:inline">Auto-refresh</span>
          <span
            v-if="autoRefresh"
            class="text-[10px] tabular-nums text-muted-foreground"
            >({{ countdown }}s)</span
          >
        </button>

        <button
          type="button"
          :disabled="refreshingAll"
          class="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-xs transition-colors hover:bg-accent disabled:opacity-50"
          title="Refresh all"
          @click="refreshAll(true)"
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="refreshingAll && 'animate-spin'"
            >refresh</span
          >
        </button>
      </div>
    </div>

    <div
      v-if="expiringFirst"
      class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      Expiring-first currently reorders accounts inside the current page.
      Cross-page ordering still follows backend pagination.
    </div>

    <!-- Empty states -->
    <Card v-if="!connectionsLoading && !hasEligibleConnections" class="py-12">
      <div class="py-12 text-center">
        <span
          class="material-symbols-outlined text-[64px] text-muted-foreground opacity-20"
          >cloud_off</span
        >
        <h3 class="mt-4 text-lg font-semibold">No Providers Connected</h3>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Connect to providers with OAuth to track your API quota limits and
          usage.
        </p>
      </div>
    </Card>
    <Card
      v-else-if="!connectionsLoading && !hasVisibleConnections"
      class="py-12"
    >
      <div class="py-12 text-center">
        <span
          class="material-symbols-outlined text-[64px] text-muted-foreground opacity-20"
          >{{ emptyState.icon }}</span
        >
        <h3 class="mt-4 text-lg font-semibold">{{ emptyState.title }}</h3>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {{ emptyState.description }}
        </p>
      </div>
    </Card>

    <div v-else class="space-y-5">
      <section
        v-for="group in providerGroups"
        :key="group.provider"
        class="space-y-2"
      >
        <div
          class="flex flex-wrap items-center gap-2 border-b border-border pb-1.5"
        >
          <ProviderLogo :provider="group.provider" size="size-5" />
          <h2 class="text-sm font-semibold capitalize">{{ group.provider }}</h2>
          <span class="text-xs text-muted-foreground"
            >{{ group.connections.length }} account{{
              group.connections.length === 1 ? "" : "s"
            }}</span
          >
          <div
            v-if="group.provider === 'codebuddy-intl-cli'"
            class="ml-auto flex items-center gap-1.5"
            title="Drain this meter on each account before falling back to that account's other meters. Once every account exhausts the chosen meter, the rest (e.g. Bonus Packs) start serving requests."
          >
            <span class="text-[11px] text-muted-foreground"
              >Priority meter</span
            >
            <select
              :value="codebuddyPriorityMeter ?? ''"
              :disabled="codebuddyPrioritySaving"
              class="h-9 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60"
              @change="
                saveCodebuddyPriorityMeter(
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">Off</option>
              <option
                v-for="name in codebuddyPriorityMeterOptions"
                :key="name"
                :value="name"
              >
                {{ name }}
              </option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <Card
            v-for="conn in group.connections"
            :key="conn.id"
            :class="
              conn.isActive === false ? 'min-w-0 p-0 opacity-60' : 'min-w-0 p-0'
            "
          >
            <div class="border-b border-border px-2 py-1.5">
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex min-w-0 items-center gap-1.5">
                  <ProviderLogo :provider="conn.provider" size="size-5" />
                  <div class="min-w-0">
                    <h3 class="truncate text-xs font-semibold capitalize">
                      {{ conn.provider }}
                    </h3>
                    <p
                      v-if="getConnectionLabel(conn)"
                      class="truncate text-[11px] text-muted-foreground"
                    >
                      {{ getConnectionLabel(conn) }}
                    </p>
                    <p
                      v-if="getConnectionSecondaryLabel(conn)"
                      class="truncate text-[10px] text-muted-foreground/80"
                    >
                      {{ getConnectionSecondaryLabel(conn) }}
                    </p>
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <!-- Card actions menu -->
                  <div class="relative">
                    <button
                      type="button"
                      :disabled="
                        deletingId === conn.id ||
                        togglingId === conn.id ||
                        resettingLimitId === conn.id
                      "
                      aria-label="Connection actions"
                      aria-haspopup="menu"
                      class="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                      @click="
                        cardMenuOpenId =
                          cardMenuOpenId === conn.id ? null : conn.id
                      "
                    >
                      <span class="material-symbols-outlined text-[14px]"
                        >more_vert</span
                      >
                    </button>
                    <template v-if="cardMenuOpenId === conn.id">
                      <button
                        type="button"
                        class="fixed inset-0 z-30 bg-transparent"
                        aria-label="Close menu"
                        @click="cardMenuOpenId = null"
                      />
                      <div
                        class="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-background/95 p-1 shadow-xl backdrop-blur"
                      >
                        <template v-if="conn.provider === 'codex'">
                          <button
                            type="button"
                            :disabled="
                              getCodexResetCreditCount(quotaData[conn.id]) <=
                                0 || loading[conn.id]
                            "
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
                            @click="
                              cardMenuOpenId = null;
                              resetConfirmState = {
                                connection: conn,
                                resetCreditCount: getCodexResetCreditCount(
                                  quotaData[conn.id],
                                ),
                              };
                            "
                          >
                            <span
                              class="material-symbols-outlined text-[14px]"
                              :class="
                                resettingLimitId === conn.id && 'animate-spin'
                              "
                            >
                              {{
                                resettingLimitId === conn.id
                                  ? "progress_activity"
                                  : "restart_alt"
                              }}
                            </span>
                            <span>Reset limit</span>
                            <span
                              class="ml-auto text-[10px] tabular-nums text-muted-foreground"
                              >{{
                                getCodexResetCreditCount(quotaData[conn.id])
                              }}</span
                            >
                          </button>
                          <button
                            type="button"
                            :disabled="loading[conn.id]"
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
                            @click="
                              cardMenuOpenId = null;
                              handleViewCodexResetCredits(conn);
                            "
                          >
                            <span class="material-symbols-outlined text-[14px]"
                              >schedule</span
                            >
                            <span>Reset credits</span>
                          </button>
                        </template>
                        <button
                          v-if="
                            AUTO_PING_SETTINGS_KEYS[conn.provider] &&
                            (conn.authType === 'oauth' ||
                              conn.provider === 'autoclaw')
                          "
                          type="button"
                          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                          @click="
                            cardMenuOpenId = null;
                            toggleAutoPing(
                              conn.id,
                              conn.provider,
                              !(
                                autoPingMaps[conn.provider]?.[conn.id] === true
                              ),
                            );
                          "
                        >
                          <span
                            class="material-symbols-outlined text-[14px]"
                            :class="
                              autoPingMaps[conn.provider]?.[conn.id] === true &&
                              'text-primary'
                            "
                            >bolt</span
                          >
                          <span>{{
                            autoPingMaps[conn.provider]?.[conn.id] === true
                              ? `${autoPingLabel(conn.provider)}: on`
                              : `${autoPingLabel(conn.provider)}: off`
                          }}</span>
                        </button>
                        <button
                          type="button"
                          :disabled="loading[conn.id]"
                          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40"
                          @click="
                            cardMenuOpenId = null;
                            refreshProvider(conn.id, conn.provider);
                          "
                        >
                          <span
                            class="material-symbols-outlined text-[14px]"
                            :class="loading[conn.id] && 'animate-spin'"
                            >refresh</span
                          >
                          <span>Refresh quota</span>
                        </button>
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                          @click="
                            cardMenuOpenId = null;
                            selectedConnection = conn;
                            showEditModal = true;
                          "
                        >
                          <span class="material-symbols-outlined text-[14px]"
                            >edit</span
                          >
                          <span>Edit</span>
                        </button>
                        <div class="mx-2 my-0.5 border-t border-border/60" />
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10"
                          @click="
                            cardMenuOpenId = null;
                            handleDeleteConnection(conn.id);
                          "
                        >
                          <span class="material-symbols-outlined text-[14px]"
                            >delete</span
                          >
                          <span>Delete</span>
                        </button>
                      </div>
                    </template>
                  </div>

                  <div
                    :title="
                      (conn.isActive ?? true)
                        ? 'Disable connection'
                        : 'Enable connection'
                    "
                  >
                    <Toggle
                      size="sm"
                      :checked="conn.isActive ?? true"
                      :disabled="
                        deletingId === conn.id ||
                        togglingId === conn.id ||
                        resettingLimitId === conn.id
                      "
                      @change="
                        (next: boolean) =>
                          handleToggleConnectionActive(conn.id, next)
                      "
                    />
                  </div>
                </div>
              </div>
            </div>

            <div class="px-1.5 py-1">
              <div
                v-if="loading[conn.id]"
                class="py-3 text-center text-muted-foreground"
              >
                <span class="material-symbols-outlined animate-spin text-[20px]"
                  >progress_activity</span
                >
              </div>
              <div v-else-if="errors[conn.id]" class="py-3 text-center">
                <span class="material-symbols-outlined text-[20px] text-red-500"
                  >error</span
                >
                <p class="mt-1 text-[10px] text-muted-foreground">
                  {{ errors[conn.id] }}
                </p>
              </div>
              <div
                v-else-if="quotaData[conn.id]?.message"
                class="py-3 text-center"
              >
                <p class="text-[10px] text-muted-foreground">
                  {{ quotaData[conn.id]?.message }}
                </p>
              </div>
              <QuotaTable
                v-else
                :quotas="quotaData[conn.id]?.quotas || []"
                compact
                paginate
                sort-mode="default"
                :show-sort-label="
                  conn.provider === 'codex' && quotaSortMode !== 'default'
                "
              />
            </div>
          </Card>
        </div>
      </section>
    </div>

    <ConfirmModal
      :open="Boolean(resetConfirmState)"
      title="Reset Codex limit?"
      :message="`Use 1 Codex reset credit for ${getConnectionLabel(resetConfirmState?.connection || ({} as QuotaConnection)) || 'this account'}. This cannot be undone. Remaining credits: ${resetConfirmState?.resetCreditCount ?? 0}.`"
      confirm-text="Reset limit"
      :loading="Boolean(resettingLimitId)"
      @confirm="
        resetConfirmState &&
          handleResetCodexLimit(
            resetConfirmState.connection.id,
            resetConfirmState.connection.provider,
          );
        resetConfirmState = null;
      "
      @close="!resettingLimitId && (resetConfirmState = null)"
    />

    <!-- Codex reset credits modal -->
    <div
      v-if="resetCreditsState"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
    >
      <div
        class="w-full max-w-2xl overflow-hidden rounded-2xl border border-input bg-background shadow-2xl"
      >
        <div
          class="flex items-start justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3"
        >
          <div class="min-w-0">
            <h3 class="text-base font-semibold">Codex Reset Credit Expiry</h3>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {{
                getConnectionLabel(resetCreditsState.connection) ||
                "Codex account"
              }}
            </p>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close reset credit expiry modal"
            @click="resetCreditsState = null"
          >
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div class="max-h-[70vh] overflow-auto p-4">
          <div
            v-if="resetCreditsState.loading"
            class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
          >
            <span class="material-symbols-outlined animate-spin text-[20px]"
              >progress_activity</span
            >
            Loading reset credits...
          </div>
          <div
            v-else-if="resetCreditsState.error"
            class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
          >
            {{ resetCreditsState.error }}
          </div>
          <div
            v-else-if="resetCreditsState.data?.credits?.length"
            class="space-y-3"
          >
            <div
              class="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <span
                >{{ resetCreditsState.data.credits.length }} reset credit{{
                  resetCreditsState.data.credits.length === 1 ? "" : "s"
                }}</span
              >
              <span
                >{{
                  resetCreditsState.data.availableCount ?? 0
                }}
                available</span
              >
            </div>
            <div class="overflow-x-auto rounded-xl border border-border">
              <table class="w-full min-w-[560px] text-left text-sm">
                <thead
                  class="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"
                >
                  <tr>
                    <th class="font-semibold px-3 py-2">Status</th>
                    <th class="font-semibold px-3 py-2">Granted At</th>
                    <th class="font-semibold px-3 py-2">Expires At</th>
                    <th class="font-semibold px-3 py-2">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(credit, index) in resetCreditsState.data.credits"
                    :key="`${credit.status}-${credit.expiresAt || index}`"
                    class="border-t border-border/60"
                  >
                    <td class="px-2.25 py-1.5">
                      <span
                        class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                        >{{ credit.status || "unknown" }}</span
                      >
                    </td>
                    <td class="px-2.25 py-1.5 text-muted-foreground">
                      {{ formatCreditDate(credit.grantedAt) }}
                    </td>
                    <td class="px-2.25 py-1.5">
                      {{ formatCreditDate(credit.expiresAt) }}
                    </td>
                    <td class="px-2.25 py-1.5 font-medium">
                      {{ formatTimeRemaining(credit.expiresAt) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div
            v-else
            class="rounded-xl border border-border bg-muted/40 px-3 py-8 text-center text-sm text-muted-foreground"
          >
            No reset credit details returned for this account.
          </div>
        </div>
      </div>
    </div>

    <EditConnectionModal
      :open="showEditModal"
      :connection="selectedConnection"
      :proxy-pools="proxyPools"
      @save="handleUpdateConnection"
      @close="
        showEditModal = false;
        selectedConnection = null;
      "
    />
  </div>
</template>
