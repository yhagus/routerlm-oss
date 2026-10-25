<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { api, describeApiError } from "@/lib/api";
import type {
  ConnectionTestJob,
  ModelItem,
  ProviderConnection,
  ProviderNode,
  ProxyPool,
  Probe407Job,
} from "@/types/api";
import { getThinkingLevels, resolveThinkingSuffix } from "@/lib/thinkingLevels";
import { isFreeModelId } from "@/lib/modelOptions";
import { getCapabilitiesForModel } from "@/lib/providerCapabilities";
import { getProviderAlias, providerMeta } from "@/lib/providerMeta";
import { getProviderCustomModelRows } from "@/lib/providerCustomModels";
import { providerLogo } from "@/lib/providerAssets";
import { cn } from "@/lib/utils";
import Card from "@/components/ui/card.vue";
import Skeleton from "@/components/ui/skeleton.vue";
import Button from "@/components/ui/button.vue";
import Input from "@/components/ui/input.vue";
import Select from "@/components/ui/select.vue";
import Badge from "@/components/ui/badge.vue";
import Toggle from "@/components/ui/toggle.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import Modal from "@/components/ui/modal.vue";
import TabSwitcher from "@/components/ui/tab-switcher.vue";
import CodexPlanModelMatrix from "@/components/providers/CodexPlanModelMatrix.vue";
import Label from "@/components/ui/label.vue";
import DropdownMenu from "@/components/ui/dropdown-menu.vue";
import type { DropdownMenuAction } from "@/components/ui/dropdown-menu.vue";
import ProviderOAuthModal from "@/components/providers/ProviderOAuthModal.vue";
import ProviderConnectionTable from "@/components/providers/ProviderConnectionTable.vue";
import ProviderConnectionEditModal from "@/components/providers/ProviderConnectionEditModal.vue";
import ProviderModelRow from "@/components/providers/ProviderModelRow.vue";
import BulkProxyModal from "@/components/providers/BulkProxyModal.vue";
import BulkMaxInFlightModal from "@/components/providers/BulkMaxInFlightModal.vue";
import AddApiKeyModal from "@/components/providers/AddApiKeyModal.vue";
import BulkImportModal from "@/components/providers/BulkImportModal.vue";
import NoAuthProxyCard from "@/components/providers/NoAuthProxyCard.vue";
import ProviderLogoInput from "@/components/providers/ProviderLogoInput.vue";
import QoderModelContextWindows from "@/components/providers/QoderModelContextWindows.vue";
import AlimsModelAvailability from "@/components/providers/AlimsModelAvailability.vue";
import InspirationCenterModal from "@/components/providers/InspirationCenterModal.vue";
import AccountDrawer from "@/components/usage/AccountDrawer.vue";
import { providerAuthModes, type ProviderAuthMode } from "@/lib/providerAuth";
import {
  AUTO_REFRESH_STORAGE_KEY,
  CLAUDE_REFRESH_INTERVAL_MS,
  REFRESH_INTERVAL_MS,
  formatBalance,
  getRemainingPercentage,
  parseQuotaData,
  type NormalizedQuotaRow,
} from "@/lib/quota";

type OneByOneStatus = {
  state: "queued" | "testing" | "success" | "failed" | "cancelled";
  error?: string | null;
};

const ONE_BY_ONE_DELAY_MS = 1000;
const AUTO_PING_SETTINGS_KEYS: Record<string, string> = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
  autoclaw: "autoclawAutoClaim",
  "codebuddy-intl-cli": "codebuddyIntlCliDailyProbe",
};
const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const providerId = computed(() => String(route.params.id || ""));

const settings = useQuery({
  queryKey: ["settings"],
  queryFn: api.settings.get,
});
const connectionsPage = ref(1);
const connectionsPageSize = computed(() => {
  const raw = (settings.data.value as Record<string, unknown> | undefined)
    ?.quotaPageSize;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
});
const connectionsTotal = ref(0);
const connectionsTotalPages = computed(() =>
  Math.max(1, Math.ceil(connectionsTotal.value / connectionsPageSize.value)),
);
const connections = useQuery({
  queryKey: [
    "provider-connections",
    providerId,
    connectionsPage,
    connectionsPageSize,
  ],
  queryFn: async () => {
    const result = await api.providers.listPaginated({
      provider: providerId.value,
      page: connectionsPage.value,
      pageSize: connectionsPageSize.value,
    });
    connectionsTotal.value = result.pagination.total;
    return result.connections as ProviderConnection[];
  },
});
// Aggregated quota across EVERY active connection of this provider — the
// paginated `connections` query above only covers the visible page, so the
// header card must not derive its number from it. Read-only on the backend;
// refetching here never spams the upstream quota endpoints.
const providerQuotaSummary = useQuery({
  queryKey: ["provider-quota-summary", providerId],
  queryFn: () => api.providers.quotaSummary(providerId.value),
  refetchInterval: 60_000,
});
const nodes = useQuery({
  queryKey: ["provider-nodes"],
  queryFn: api.nodes.list,
});
const pools = useQuery({
  queryKey: ["proxy-pools"],
  queryFn: api.proxies.list,
});
const customModels = useQuery({
  queryKey: ["custom-models"],
  queryFn: api.models.custom,
});
const capabilityOverrides = useQuery({
  queryKey: ["model-capability-overrides", providerId],
  queryFn: () => api.models.capabilityOverrides(),
});
const aliases = useQuery({
  queryKey: ["model-aliases"],
  queryFn: api.models.aliases,
});

const meta = computed(() => providerMeta(providerId.value));
const providerNode = computed<ProviderNode | null>(
  () =>
    (nodes.data.value || []).find(
      (node) =>
        node.id === providerId.value || node.prefix === providerId.value,
    ) || null,
);
const isCompatible = computed(() => Boolean(providerNode.value));
const isAnthropicCompatible = computed(
  () => providerNode.value?.type === "anthropic-compatible",
);
const authModes = computed<ProviderAuthMode[]>(() =>
  providerAuthModes(providerId.value, isCompatible.value),
);
const isOAuth = computed(() => authModes.value.includes("oauth"));
const supportsApiKeyAuth = computed(() => authModes.value.includes("apikey"));
const isFreeNoAuth = computed(() => meta.value.noAuth === true);
const hasDualAuthModes = computed(
  () => !isCompatible.value && isOAuth.value && supportsApiKeyAuth.value,
);
const oauthConnectionLabel = computed(() =>
  providerId.value === "grok-cli" ? "Grok CLI Device Login" : "OAuth",
);
const apiKeyConnectionLabel = "API Key";

const providerAlias = computed(() => getProviderAlias(providerId.value));
const providerStorageAlias = computed(() =>
  isCompatible.value ? providerId.value : providerAlias.value,
);
const providerDisplayAlias = computed(() =>
  isCompatible.value
    ? providerNode.value?.prefix || providerId.value
    : providerAlias.value,
);
const providerName = computed(() =>
  providerNode.value
    ? providerNode.value.name ||
      (isAnthropicCompatible.value
        ? "Anthropic Compatible"
        : "OpenAI Compatible")
    : meta.value.name || providerId.value,
);

const allConnections = computed(() => [...(connections.data.value || [])]);
const hasActiveConnection = computed(() =>
  allConnections.value.some((connection) => connection.isActive !== false),
);
const activeConnectionCount = computed(() => {
  const backendCount = providerQuotaSummary.data.value?.activeConnectionCount;
  if (backendCount !== undefined) return backendCount;
  return allConnections.value.filter((c) => c.isActive !== false).length;
});
const inactiveConnectionCount = computed(() => {
  const backendCount = providerQuotaSummary.data.value?.inactiveConnectionCount;
  if (backendCount !== undefined) return backendCount;
  return allConnections.value.filter((c) => c.isActive === false).length;
});
const bitdeerExhaustedCount = computed(
  () => allConnections.value.filter((c) => c.data?.bitdeerExhaustedAt).length,
);
const bitdeerAvailableCount = computed(
  () =>
    allConnections.value.filter(
      (c) => c.isActive !== false && !c.data?.bitdeerExhaustedAt,
    ).length,
);
const accountSummary = computed(
  () =>
    `${activeConnectionCount.value} active · ${inactiveConnectionCount.value} inactive`,
);
function weightedRemaining(rows: NormalizedQuotaRow[]): number {
  let weightedSum = 0;
  let weight = 0;
  let simpleSum = 0;
  let simpleCount = 0;
  for (const row of rows) {
    const pct = Math.min(100, Math.max(0, getRemainingPercentage(row)));
    const total = row.total || 0;
    if (total > 0) {
      weightedSum += pct * total;
      weight += total;
    } else {
      simpleSum += pct;
      simpleCount += 1;
    }
  }
  if (weight > 0) return Math.min(100, Math.round(weightedSum / weight));
  if (simpleCount > 0)
    return Math.min(100, Math.round(simpleSum / simpleCount));
  return 0;
}

type QuotaMeter = {
  key: string;
  label: string;
  kind: "balance" | "percentage";
  balance: number;
  unit: string;
  remaining: number;
  creditBalance: number | null;
};

const quotaMeters = computed<QuotaMeter[]>(() => {
  const backendMeters = providerQuotaSummary.data.value?.quotaMeters;
  if (backendMeters?.length) {
    return backendMeters.map((meter) => ({
      key: meter.key,
      label: meter.label,
      kind: meter.kind,
      balance: meter.balance,
      unit: meter.unit,
      remaining: meter.remaining,
      creditBalance: meter.creditBalance,
    }));
  }
  const map = new Map<string, QuotaMeter & { rows: NormalizedQuotaRow[] }>();
  for (const connection of allConnections.value) {
    for (const quota of quotaData.value[connection.id]?.quotas || []) {
      const key = String(quota.modelKey || quota.name);
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(quota);
        continue;
      }
      map.set(key, {
        key,
        label: quota.name,
        kind: quota.balance !== undefined ? "balance" : "percentage",
        balance: 0,
        unit: quota.unit || "points",
        remaining: 0,
        creditBalance: null,
        rows: [quota],
      });
    }
  }
  return [...map.values()].map(({ rows, ...meter }) => {
    if (meter.kind === "balance") {
      return {
        ...meter,
        balance: rows.reduce((sum, row) => sum + (row.balance || 0), 0),
      };
    }
    const creditRows = rows.filter((row) => row.creditBalance !== undefined);
    return {
      ...meter,
      remaining: weightedRemaining(rows),
      creditBalance: creditRows.length
        ? creditRows.reduce((sum, row) => sum + (row.creditBalance || 0), 0)
        : null,
    };
  });
});

const remainingCreditBalance = computed(() => {
  const summary = providerQuotaSummary.data.value;
  if (summary) return summary.totalCreditBalance || 0;
  return quotaMeters.value.reduce(
    (sum, meter) => sum + (meter.creditBalance || 0),
    0,
  );
});

const remainingAmountUnit = computed(() => {
  const meter = quotaMeters.value.find(
    (row) => row.creditBalance !== null && row.unit,
  );
  return meter?.unit || "credits";
});

// Union of meter names across every visible codebuddy-intl-cli connection.
// Fallback list keeps the dropdown useful even before quotas hydrate.
const codebuddyPriorityMeterOptions = computed<string[]>(() => {
  const names = new Set<string>();
  for (const conn of allConnections.value) {
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
  if (codebuddyPriorityMeter.value) names.add(codebuddyPriorityMeter.value);
  return Array.from(names).sort((a, b) => a.localeCompare(b));
});

const isCodexProvider = computed(() => providerId.value === "codex");
const codexPlanCounts = computed<Array<[string, number]>>(() => {
  if (!isCodexProvider.value) return [];
  const counts = new Map<string, number>();
  for (const connection of allConnections.value) {
    const raw =
      quotaData.value[connection.id]?.plan ||
      field(connection, "chatgptPlanType", "");
    const plan =
      String(raw || "")
        .trim()
        .toLowerCase() || "unknown";
    counts.set(plan, (counts.get(plan) || 0) + 1);
  }
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
});

// Mixed currencies are listed side by side ("0 USD + 0.266 CNY"), never summed.
function formatBalancesByUnit(
  balances: Array<{ unit: string; balance: number }>,
): string {
  return balances
    .map(({ unit, balance }) => `${formatBalance(balance)} ${unit}`)
    .join(" + ");
}

const quotaSummary = computed(() => {
  // Prefer the server-side aggregate: it covers every active connection of
  // the provider, not just the ones rendered on the current page.
  const aggregate = providerQuotaSummary.data.value;
  if (aggregate && aggregate.kind) {
    if (aggregate.kind === "balance") {
      return {
        kind: "balance" as const,
        value: aggregate.balancesByUnit?.length
          ? formatBalancesByUnit(aggregate.balancesByUnit)
          : `${formatBalance(aggregate.totalBalance || 0)} ${aggregate.unit || "points"}`,
        remaining: null,
      };
    }
    const percentage = aggregate.remainingPercent ?? 0;
    return {
      kind: "percentage" as const,
      value: `${percentage}%`,
      remaining: percentage,
    };
  }
  const meters = quotaMeters.value;
  if (!meters.length) return null;
  const balanceMeters = meters.filter((meter) => meter.kind === "balance");
  if (balanceMeters.length) {
    const byUnit = new Map<string, number>();
    for (const meter of balanceMeters) {
      const unit = meter.unit || "points";
      byUnit.set(unit, (byUnit.get(unit) || 0) + meter.balance);
    }
    return {
      kind: "balance" as const,
      value: formatBalancesByUnit(
        [...byUnit].map(([unit, balance]) => ({ unit, balance })),
      ),
      remaining: null,
    };
  }
  const percentage = weightedRemaining(
    allConnections.value.flatMap(
      (connection) => quotaData.value[connection.id]?.quotas || [],
    ),
  );
  return {
    kind: "percentage" as const,
    value: `${percentage}%`,
    remaining: percentage,
  };
});
const quotaTone = computed<"default" | "success" | "warning" | "destructive">(
  () => {
    const remaining = quotaSummary.value?.remaining;
    if (remaining === null || remaining === undefined) return "default";
    if (remaining > 70) return "success";
    if (remaining >= 30) return "warning";
    return "destructive";
  },
);
const activePools = computed(() =>
  (pools.data.value || []).filter(
    (pool) => (pool as { isActive?: boolean }).isActive !== false,
  ),
);
const providerSettings = computed(
  () =>
    (
      settings.data.value?.providerStrategies as
        Record<string, Record<string, unknown>> | undefined
    )?.[providerId.value] || {},
);
const roundRobinOn = computed(
  () => providerSettings.value.fallbackStrategy === "round-robin",
);
const thinkingMode = ref("auto");
const stickyLimit = ref("1");
// Empty means no per-connection in-flight limit.
const maxInFlight = ref("");
const autoPingKey = computed(
  () => AUTO_PING_SETTINGS_KEYS[providerId.value] || "",
);
const autoPingConfig = computed(() =>
  autoPingKey.value
    ? (
        settings.data.value as unknown as Record<
          string,
          { enabled?: boolean; connections?: Record<string, boolean> }
        >
      )?.[autoPingKey.value] || {}
    : {},
);

const isAutoclaw = computed(() => providerId.value === "autoclaw");
type AutoclawClaim = {
  id: string;
  name: string;
  claimed: boolean;
  rewardPoints: number;
};
const autoclawTasks = ref<Record<string, AutoclawClaim[]>>({});
const autoclawClaiming = ref<Record<string, Record<string, boolean>>>({});
const autoclawLoaded = ref<Record<string, boolean>>({});
async function loadAutoclawTasks() {
  if (!isAutoclaw.value) return;
  for (const connection of allConnections.value) {
    try {
      const data = await api.usage.autoclawTasks.get(connection.id);
      autoclawTasks.value = {
        ...autoclawTasks.value,
        [connection.id]: data.claims,
      };
    } catch {
      /* ignore per-connection load errors */
    } finally {
      autoclawLoaded.value = { ...autoclawLoaded.value, [connection.id]: true };
    }
  }
}
async function claimAutoclaw(connectionId: string, claimId: string) {
  autoclawClaiming.value = {
    ...autoclawClaiming.value,
    [connectionId]: {
      ...autoclawClaiming.value[connectionId],
      [claimId]: true,
    },
  };
  try {
    const result = await api.usage.autoclawTasks.claim(connectionId, claimId);
    const claimed =
      result.status === "claimed" || result.status === "completed";
    const previous = autoclawTasks.value[connectionId] || [];
    autoclawTasks.value = {
      ...autoclawTasks.value,
      [connectionId]: previous.map((claim) =>
        claim.id === claimId
          ? {
              ...claim,
              claimed,
              rewardPoints: Number(result.rewardPoints) || claim.rewardPoints,
            }
          : claim,
      ),
    };
    autoclawLoaded.value = { ...autoclawLoaded.value, [connectionId]: true };
  } catch {
    /* keep prior state on error */
  } finally {
    autoclawClaiming.value = {
      ...autoclawClaiming.value,
      [connectionId]: {
        ...autoclawClaiming.value[connectionId],
        [claimId]: false,
      },
    };
  }
}

const bulkDailyLoginRunning = ref(false);
const bulkInspirationRunning = ref(false);
async function runBulkDailyLogin() {
  if (bulkDailyLoginRunning.value) return;
  const targets = allConnections.value;
  if (!targets.length) return;
  bulkDailyLoginRunning.value = true;
  try {
    for (const connection of targets) {
      await claimAutoclaw(connection.id, "daily_signin");
    }
  } finally {
    bulkDailyLoginRunning.value = false;
  }
}
async function runBulkInspirationAllLanguages() {
  if (bulkInspirationRunning.value) return;
  const targets = allConnections.value;
  if (!targets.length) return;
  bulkInspirationRunning.value = true;
  try {
    for (const connection of targets) {
      try {
        await api.usage.inspirationCenter.claimAll(connection.id, "all");
      } catch {
        /* continue with next account on error */
      }
    }
    await loadAutoclawTasks();
  } finally {
    bulkInspirationRunning.value = false;
  }
}

const autoclawBulkActionItems = computed<DropdownMenuAction[]>(() => {
  return [
    {
      key: "daily-login",
      label: "Daily Login",
      disabled:
        bulkDailyLoginRunning.value ||
        bulkInspirationRunning.value ||
        quotaRefreshingAll.value,
    },
    {
      key: "all-inspirations",
      label: "All Inspirations",
      disabled:
        bulkDailyLoginRunning.value ||
        bulkInspirationRunning.value ||
        quotaRefreshingAll.value,
    },
    {
      key: "refresh-quotas",
      label: "Refresh Quotas",
      disabled:
        bulkDailyLoginRunning.value ||
        bulkInspirationRunning.value ||
        quotaRefreshingAll.value,
    },
  ];
});

async function handleAutoclawBulkAction(key: string) {
  switch (key) {
    case "daily-login":
      await runBulkDailyLogin();
      break;
    case "all-inspirations":
      await runBulkInspirationAllLanguages();
      break;
    case "refresh-quotas":
      await refreshAllQuotas(true);
      break;
  }
}

const inspirationConnectionId = ref<string | null>(null);
const inspirationLanguage = ref("id");
const inspirationItems = ref<
  Array<{
    inspiration_id: string;
    title: string;
    reward_points: number;
    completed: boolean;
    done: boolean;
  }>
>([]);
const inspirationLoading = ref(false);
const inspirationClaiming = ref<Record<string, boolean>>({});
const inspirationClaimingAll = ref(false);
const inspirationError = ref<string | null>(null);
const inspirationConnectionLabel = computed(() => {
  const connection = allConnections.value.find(
    (item) => item.id === inspirationConnectionId.value,
  );
  return (
    connection?.name || connection?.email || inspirationConnectionId.value || ""
  );
});
async function loadInspirationItems() {
  const connectionId = inspirationConnectionId.value;
  if (!connectionId) return;
  inspirationLoading.value = true;
  inspirationError.value = null;
  try {
    const data = await api.usage.inspirationCenter.list(
      connectionId,
      inspirationLanguage.value,
    );
    inspirationItems.value = data.items;
    if (data.language) inspirationLanguage.value = data.language;
  } catch (error) {
    inspirationError.value =
      error instanceof Error ? error.message : "Failed to load cards";
    inspirationItems.value = [];
  } finally {
    inspirationLoading.value = false;
  }
}
async function openInspirationCenter(connectionId: string) {
  inspirationConnectionId.value = connectionId;
  await loadInspirationItems();
  await loadAutoclawTasks();
}
function closeInspirationCenter() {
  inspirationConnectionId.value = null;
}
async function claimInspiration(inspirationId: string) {
  const connectionId = inspirationConnectionId.value;
  if (!connectionId) return;
  inspirationClaiming.value = {
    ...inspirationClaiming.value,
    [inspirationId]: true,
  };
  try {
    await api.usage.inspirationCenter.claim(
      connectionId,
      inspirationId,
      inspirationLanguage.value,
    );
    await loadInspirationItems();
    await loadAutoclawTasks();
  } catch {
    /* keep prior state on error */
  } finally {
    inspirationClaiming.value = {
      ...inspirationClaiming.value,
      [inspirationId]: false,
    };
  }
}
async function claimAllInspirations() {
  const connectionId = inspirationConnectionId.value;
  if (!connectionId || inspirationClaimingAll.value) return;
  inspirationClaimingAll.value = true;
  try {
    await api.usage.inspirationCenter.claimAll(
      connectionId,
      inspirationLanguage.value,
    );
    await loadInspirationItems();
    await loadAutoclawTasks();
  } catch {
    /* keep prior state on error */
  } finally {
    inspirationClaimingAll.value = false;
  }
}
async function claimAllInspirationsAllLanguages() {
  const connectionId = inspirationConnectionId.value;
  if (!connectionId || inspirationClaimingAll.value) return;
  inspirationClaimingAll.value = true;
  try {
    await api.usage.inspirationCenter.claimAll(connectionId, "all");
    await loadInspirationItems();
    await loadAutoclawTasks();
  } catch {
    /* keep prior state on error */
  } finally {
    inspirationClaimingAll.value = false;
  }
}

const accountDrawerId = ref<string | null>(null);
const accountDrawerLabel = computed(() => {
  const connection = allConnections.value.find(
    (item) => item.id === accountDrawerId.value,
  );
  return connection?.name || connection?.email || accountDrawerId.value || "";
});

const isCodebuddyIntlCli = computed(
  () => providerId.value === "codebuddy-intl-cli",
);
const codebuddyProbed = ref<
  Record<
    string,
    {
      probed: boolean;
      checkin: {
        state: string;
        credit: number | null;
        streakDays: number | null;
        error: string | null;
      } | null;
      reported: boolean;
    }
  >
>({});
// codebuddy-intl-cli: name of the quota meter (e.g. "Monthly") to drain first
// before each account falls back to its other meters. Null = feature disabled.
const codebuddyPriorityMeter = ref<string | null>(null);
// codebuddy-intl-cli: models that keep an independent exhausted cooldown. Every
// other model shares the account-wide quota lock.
const codebuddyExcludedModels = ref<string[]>([]);
const codebuddyExcludedDraft = ref("");
const codebuddyExcludedSaving = ref(false);
const codebuddyPrioritySaving = ref(false);
const showPriorityMeterModal = ref(false);
const showProbe407Confirm = ref(false);
const showInviteBindModal = ref(false);
const inviteBindIds = ref<string[]>([]);
const inviteBindCode = ref("");
const inviteBindRunning = ref(false);
const inviteBindProxyPoolId = ref("");
const inviteBindContinuing = computed(() =>
  inviteBindIds.value.some((id) => {
    const conn = allConnections.value.find((c) => c.id === id);
    const chain = (conn?.data as Record<string, unknown> | undefined)?.inviteChain as { status?: string } | undefined;
    return Boolean(chain && typeof chain === "object" && chain.status === "failed");
  }),
);
const inviteBindModalTitle = computed(() => {
  const count = inviteBindIds.value.length;
  const noun = inviteBindContinuing.value ? "Continue binding" : "Bind invite code";
  return count > 1 ? `${noun} on ${count} connections` : noun;
});
const inviteBindProxyOptions = computed(() => [
  { value: "__keep__", label: "Keep current proxy" },
  { value: "__none__", label: "None (direct)" },
  ...((pools.data.value || [])
    .filter((pool) => pool.isActive === true)
    .map((pool) => ({ value: pool.id, label: pool.name }))),
]);
const probe407ModelInput = ref("");
const PROBE407_DEFAULT_TIMEOUT_S = 7;
const PROBE407_MODEL_SUGGESTIONS = [
  "grok-4.6",
  "grok-4.6-high",
  "grok-4.7",
  "grok-4.7-high",
];
const probe407TimeoutInput = ref(String(PROBE407_DEFAULT_TIMEOUT_S));
const PROBE407_DEFAULT_CONCURRENCY = 5;
const probe407ConcurrencyInput = ref(String(PROBE407_DEFAULT_CONCURRENCY));
type ProbeDetail = {
  url?: string;
  method?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseStatus?: number;
  responseStatusText?: string;
  responseBody?: string;
  startedAt?: string;
  endedAt?: string;
};
type CodebuddyProbeRecord = {
  day: string;
  status: string;
  error: string | null;
  updatedAt: string;
  probe: ProbeDetail | null;
  checkin: {
    state: string;
    credit: number | null;
    streakDays: number | null;
    error: string | null;
    detail?: ProbeDetail;
  } | null;
  reported: boolean;
};
const codebuddyProbeHistory = ref<{
  connection: ProviderConnection;
  loading: boolean;
  error: string | null;
  records: CodebuddyProbeRecord[];
  expandedDay: string | null;
} | null>(null);
async function openCodebuddyProbeHistory(connectionId: string) {
  const connection = allConnections.value.find((c) => c.id === connectionId);
  if (!connection) return;
  codebuddyProbeHistory.value = {
    connection,
    loading: true,
    error: null,
    records: [],
    expandedDay: null,
  };
  try {
    const data = await api.usage.codebuddyProbe.get(connectionId);
    const records = ((data.records || []) as Array<Record<string, unknown>>)
      .map((record) => {
        const payload = record.payload as Record<string, unknown> | undefined;
        const probe = payload?.probe as ProbeDetail | undefined;
        const checkin = payload?.checkin as
          | {
              state: string;
              credit: number | null;
              streakDays: number | null;
              error: string | null;
              detail?: ProbeDetail;
            }
          | null
          | undefined;
        return {
          day: String(record.day || ""),
          status: String(record.status || "unknown"),
          error: record.error == null ? null : String(record.error),
          updatedAt: String(record.updatedAt || ""),
          probe: probe ?? null,
          checkin: checkin ?? null,
          reported: payload?.report === true,
        };
      })
      .sort((left, right) =>
        left.day < right.day ? 1 : left.day > right.day ? -1 : 0,
      );
    codebuddyProbeHistory.value = {
      connection,
      loading: false,
      error: null,
      records,
      expandedDay: null,
    };
  } catch (error) {
    codebuddyProbeHistory.value = {
      connection,
      loading: false,
      error: error instanceof Error ? error.message : "Failed to load history",
      records: [],
      expandedDay: null,
    };
  }
}
async function loadCodebuddyProbed() {
  if (!isCodebuddyIntlCli.value) return;
  for (const connection of allConnections.value) {
    try {
      const data = await api.usage.codebuddyProbe.get(connection.id);
      codebuddyProbed.value = {
        ...codebuddyProbed.value,
        [connection.id]: {
          probed: data.probe.probed === true,
          checkin: data.probe.checkin,
          reported: data.probe.reported,
        },
      };
    } catch {
      /* ignore per-connection load errors */
    }
  }
}

const providerThinking = computed(
  () =>
    (
      settings.data.value?.providerThinking as
        Record<string, { mode?: string }> | undefined
    )?.[providerId.value]?.mode || "auto",
);
watch(
  providerThinking,
  (value) => {
    thinkingMode.value = value;
  },
  { immediate: true },
);
watch(
  () => providerSettings.value.stickyRoundRobinLimit,
  (value) => {
    stickyLimit.value = String(value ?? 1);
  },
  { immediate: true },
);
watch(
  () => providerSettings.value.maxInFlightPerConnection,
  (value) => {
    maxInFlight.value = Number(value) >= 1 ? String(value) : "";
  },
  { immediate: true },
);
watch(
  () =>
    (settings.data.value as Record<string, any>)?.codebuddyIntlCli
      ?.priorityMeter,
  (value) => {
    codebuddyPriorityMeter.value =
      typeof value === "string" && value.trim() ? value.trim() : null;
  },
  { immediate: true },
);
watch(
  () =>
    (settings.data.value as Record<string, any>)?.codebuddyIntlCli
      ?.exhaustedExcludedModels,
  (value) => {
    codebuddyExcludedModels.value = Array.isArray(value)
      ? value
          .map((model) => String(model).trim())
          .filter(Boolean)
      : [];
  },
  { immediate: true },
);

const groupOptions = computed(() =>
  [
    ...new Set(
      allConnections.value
        .map((c) => String(field(c, "group", "")).trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b)),
);
const groupFilter = ref("all");
const groupFilterOptions = computed(() => [
  { value: "all", label: "All groups" },
  ...groupOptions.value.map((name) => ({ value: name, label: name })),
]);
const visibleConnections = computed(() => {
  const filtered =
    groupFilter.value === "all"
      ? allConnections.value
      : allConnections.value.filter(
          (c) => String(field(c, "group", "")).trim() === groupFilter.value,
        );
  return filtered;
});
const firstConnectionId = computed(() => allConnections.value[0]?.id || null);
const lastConnectionId = computed(
  () => allConnections.value[allConnections.value.length - 1]?.id || null,
);

function field<T>(
  connection: ProviderConnection,
  name: string,
  fallback: T,
): T {
  const value =
    (connection as unknown as Record<string, unknown>)[name] ??
    (connection.data as Record<string, unknown> | undefined)?.[name];
  return (value === undefined || value === null ? fallback : value) as T;
}

const models = useQuery({
  queryKey: ["provider-models", providerId],
  queryFn: () => api.providers.models(providerId.value),
  enabled: computed(() => !connections.isPending.value),
});

const disabled = useQuery({
  queryKey: ["disabled-models", providerStorageAlias],
  queryFn: () => api.models.disabled(providerStorageAlias.value),
});
const disabledModelIds = computed(
  () => new Set((disabled.data.value || []).map((item) => item.id)),
);
const aliasMap = computed(() => aliases.data.value || {});
// A custom provider has no model catalog. Its /models response only repeats
// its custom models, which must stay custom rows so they can be deleted.
const builtInModels = computed(() =>
  isCompatible.value
    ? []
    : ((models.data.value?.data || []) as Array<{ id: string; name?: string }>),
);
const customModelRows = computed(() =>
  getProviderCustomModelRows({
    customModels: (customModels.data.value || []) as Array<{
      id?: string;
      name?: string;
      providerAlias?: string;
      kind?: string;
      type?: string;
    }>,
    modelAliases: aliasMap.value,
    providerAlias: providerStorageAlias.value,
    builtInModels: builtInModels.value,
    type: "llm",
  }),
);
const allModels = computed(() => builtInModels.value);
const displayModels = computed(() =>
  allModels.value.filter((m) => !disabledModelIds.value.has(m.id)),
);
// "Only Free" narrows the Available Models card to -free / :free variants.
const modelPriceFilter = ref<"all" | "free">("all");
const modelPriceFilterOptions = [
  { value: "all", label: "All Models" },
  { value: "free", label: "Only Free" },
];
const hasFreeModels = computed(() =>
  [...customModelRows.value, ...displayModels.value].some((m) =>
    isFreeModelId(m.id),
  ),
);
const onlyFreeModels = computed(
  () => modelPriceFilter.value === "free" && hasFreeModels.value,
);
const visibleCustomModelRows = computed(() =>
  onlyFreeModels.value
    ? customModelRows.value.filter((m) => isFreeModelId(m.id))
    : customModelRows.value,
);
const visibleDisplayModels = computed(() =>
  onlyFreeModels.value
    ? displayModels.value.filter((m) => isFreeModelId(m.id))
    : displayModels.value,
);
watch(providerId, () => {
  modelPriceFilter.value = "all";
});
function selectModelPriceFilter(value: string | number) {
  modelPriceFilter.value = value === "free" ? "free" : "all";
}
const disabledDisplayModels = computed(() =>
  allModels.value.filter((m) => disabledModelIds.value.has(m.id)),
);
// Same list the "Available Models" card renders (custom rows first, then the
// enabled built-in/discovered models), reused by the Alibaba Studio free-tier
// availability card so both surfaces always agree. Deduped by model id.
const alimsAvailabilityModels = computed(() => {
  const seen = new Set<string>();
  const rows: Array<{ id: string; name: string }> = [];
  for (const model of [...customModelRows.value, ...displayModels.value]) {
    const id = String(model.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name: model.name || id });
  }
  return rows;
});
const providerThinkingLevels = computed(() => {
  const set = new Set<string>();
  const seen = new Set<string>();
  const addLevels = (modelId?: string) => {
    if (!modelId || seen.has(modelId)) return;
    seen.add(modelId);
    const levels = getThinkingLevels(providerId.value, modelId);
    if (levels)
      for (const level of levels) if (level !== "none") set.add(level);
  };
  for (const m of allModels.value) addLevels(m.id);
  for (const entry of customModelRows.value) addLevels(entry.id);
  return set.size ? ["auto", ...set] : null;
});
const thinkingOptions = computed(() =>
  (providerThinkingLevels.value || []).map((level) => ({
    value: level,
    label: `Thinking: ${level.charAt(0).toUpperCase() + level.slice(1)}`,
  })),
);
const compatibleApiTypeOptions = [
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
];
function resolveSuffix(modelId: string): string | null {
  if (!thinkingMode.value || thinkingMode.value === "auto") return null;
  const levels = getThinkingLevels(providerId.value, modelId);
  return levels && levels.includes(thinkingMode.value)
    ? thinkingMode.value
    : null;
}

// Suggested free models from the provider's public models API (v1 fetchSuggestedModels).
const suggestedModels = ref<
  Array<{ id: string; name?: string; contextLength?: number }>
>([]);
watch(
  [providerId, () => meta.value.modelsFetcher],
  async ([id, fetcher]) => {
    suggestedModels.value = [];
    if (!fetcher?.url || !fetcher?.type) return;
    try {
      const result = await api.providers.suggestedModels(
        fetcher.url,
        fetcher.type,
      );
      suggestedModels.value = (result.data || []) as Array<{
        id: string;
        name?: string;
        contextLength?: number;
      }>;
    } catch {
      suggestedModels.value = [];
    }
  },
  { immediate: true },
);
const suggestedNotAdded = computed(() => {
  if (!suggestedModels.value.length) return [];
  const addedFullModels = new Set([
    ...Object.values(aliasMap.value),
    ...customModelRows.value.map((model) => model.fullModel),
  ]);
  const hardcodedIds = new Set(allModels.value.map((m) => m.id));
  return suggestedModels.value.filter(
    (m) =>
      !addedFullModels.has(`${providerStorageAlias.value}/${m.id}`) &&
      !hardcodedIds.has(m.id),
  );
});

const showAddCustomModel = ref(false);
const customModelDraft = ref("");
const customModelTest = ref<"testing" | "ok" | "error" | null>(null);
const customModelError = ref("");
const customModelCaps = reactive({
  vision: false,
  reasoning: false,
  search: false,
  audioInput: false,
  imageOutput: false,
});
const editingModelId = ref<string | null>(null);
const CAP_KEYS = [
  "vision",
  "reasoning",
  "search",
  "audioInput",
  "imageOutput",
] as const;

function selectedCaps(): Record<string, boolean> {
  const caps: Record<string, boolean> = {};
  for (const key of CAP_KEYS) caps[key] = customModelCaps[key] === true;
  return caps;
}

function resetCustomModelForm() {
  customModelDraft.value = "";
  customModelTest.value = null;
  customModelError.value = "";
  editingModelId.value = null;
  for (const key of CAP_KEYS) customModelCaps[key] = false;
}

// Strip only this provider's own prefix. Upstream model IDs may contain "/"
// themselves (e.g. River's "zai-org/GLM-5.3-Flash").
function stripAlias(value: string): string {
  const trimmed = value.trim();
  const prefixes = [
    providerStorageAlias.value,
    providerDisplayAlias.value,
    providerId.value,
  ];
  for (const prefix of prefixes) {
    if (prefix && trimmed.startsWith(`${prefix}/`))
      return trimmed.slice(prefix.length + 1);
  }
  return trimmed;
}

async function testCustomModel() {
  const cleanId = stripAlias(customModelDraft.value);
  if (!cleanId || customModelTest.value === "testing") return;
  customModelTest.value = "testing";
  customModelError.value = "";
  try {
    const result = await api.models.test(
      `${providerStorageAlias.value}/${cleanId}`,
      "llm",
    );
    customModelTest.value = result.ok ? "ok" : "error";
    customModelError.value = result.ok ? "" : result.error || "";
  } catch (error) {
    customModelTest.value = "error";
    customModelError.value = error instanceof Error ? error.message : "";
  }
}

function openAddCustomModel() {
  resetCustomModelForm();
  showAddCustomModel.value = true;
}

function openEditModel(modelId: string) {
  resetCustomModelForm();
  editingModelId.value = modelId;
  customModelDraft.value = modelId;
  const effective = capsFor(modelId) || {};
  for (const key of CAP_KEYS) customModelCaps[key] = effective[key] === true;
  showAddCustomModel.value = true;
}

async function saveCustomModel() {
  const cleanId = stripAlias(customModelDraft.value);
  if (!cleanId) return;
  const caps = selectedCaps();
  if (!editingModelId.value) {
    const enabled = Object.fromEntries(
      Object.entries(caps).filter(([, value]) => value),
    );
    await api.models.saveCustom({
      providerAlias: providerStorageAlias.value,
      id: cleanId,
      type: "llm",
      capabilities: Object.keys(enabled).length ? enabled : undefined,
    });
    if (Object.keys(enabled).length) {
      await api.models.saveCapabilities(
        providerStorageAlias.value,
        cleanId,
        enabled,
      );
    }
  } else {
    await api.models.saveCapabilities(
      providerStorageAlias.value,
      cleanId,
      caps,
    );
  }
  await refresh();
  resetCustomModelForm();
  showAddCustomModel.value = false;
}

const showOAuthModal = ref(false);
const showAddApiKeyModal = ref(false);
const addConnectionError = ref("");
const showEditModal = ref(false);
const editingConnection = ref<ProviderConnection | null>(null);
const showEditNodeModal = ref(false);
const showBulkProxyModal = ref(false);
const showBulkMaxInFlightModal = ref(false);
const bulkMaxInFlightRunning = ref(false);
const showBulkImport = ref<
  "codex" | "qoder" | "grok-cli" | "codebuddy-intl-cli" | null
>(null);
const exportingGrokCli = ref(false);
const showAgRiskModal = ref(false);
const probe407Running = ref(false);
const probe407Job = ref<Probe407Job | null>(null);
let probe407PollTimer: number | undefined;
const clearWaitRunning = ref(false);
const confirmState = ref<{
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void | Promise<void>;
} | null>(null);
const selectedConnectionIds = ref<string[]>([]);
const modelTestResults = ref<Record<string, "ok" | "error">>({});
const modelsTestError = ref("");
const testingModelIds = ref(new Set<string>());
const importingModels = ref(false);
const oneByOneRunning = ref(false);
const oneByOneStopping = ref(false);
const oneByOneCurrentConnectionId = ref<string | null>(null);
const oneByOneResults = ref<Record<string, OneByOneStatus>>({});
const oneByOneSummary = ref<{
  total: number;
  completed: number;
  passed: number;
  failed: number;
  stopped: boolean;
} | null>(null);
const oneByOneJobId = ref<string | null>(null);
let oneByOnePollTimer: number | undefined;
const nodeForm = reactive({
  name: "",
  prefix: "",
  baseUrl: "",
  apiType: "chat",
  logo: null as string | null,
});
const nodeFormError = ref("");

const allSelected = computed(
  () =>
    visibleConnections.value.length > 0 &&
    visibleConnections.value.every((c) =>
      selectedConnectionIds.value.includes(c.id),
    ),
);
// Guard: the stale-refresh-on-mount runs once per page visit, not on every
// subsequent allConnections update (pagination, selection, polling).
let staleRefreshDone = false;
watch(
  allConnections,
  (rows) => {
    selectedConnectionIds.value = selectedConnectionIds.value.filter((id) =>
      rows.some((row) => row.id === id),
    );
    if (isAutoclaw.value) void loadAutoclawTasks();
    if (isCodebuddyIntlCli.value) void loadCodebuddyProbed();
    // On first load, refresh any stale quota snapshots (missing, error, or past
    // due) so the bars show current numbers. Fresh snapshots skip the upstream
    // fetch, so this does not spam provider quota endpoints.
    if (!staleRefreshDone && rows.length) {
      staleRefreshDone = true;
      void api.usage
        .staleRefresh(rows.map((row) => row.id))
        .then(() => fetchQuotaBulk(rows.map((row) => row.id)))
        .catch(() => {});
    }
  },
  { immediate: true },
);
const selectedConnections = computed(() =>
  allConnections.value.filter((c) =>
    selectedConnectionIds.value.includes(c.id),
  ),
);
const selectedActiveCodexOAuthConnections = computed(() =>
  selectedConnections.value.filter(
    (connection) =>
      connection.isActive !== false && connection.authType === "oauth",
  ),
);
const selectedActiveQoderOAuthConnections = computed(() =>
  selectedConnections.value.filter(
    (connection) =>
      connection.isActive !== false && connection.authType === "oauth",
  ),
);
const selectedActiveCodebuddyIntlConnections = computed(() =>
  selectedConnections.value.filter(
    (connection) => connection.isActive !== false,
  ),
);
// Mirrors the row-level "Clear wait" check in ProviderConnectionTable.
function hasActiveWaitWindow(connection: ProviderConnection): boolean {
  const source = {
    ...(connection as unknown as Record<string, unknown>),
    ...((connection.data as Record<string, unknown> | undefined) || {}),
  };
  const now = Date.now();
  return Object.entries(source).some(
    ([key, value]) =>
      key.startsWith("modelLock_") &&
      Boolean(value) &&
      new Date(String(value)).getTime() > now,
  );
}
const selectedWaitingConnections = computed(() =>
  selectedConnections.value.filter(hasActiveWaitWindow),
);
const selectedApiKeyConnections = computed(() =>
  selectedConnections.value.filter(
    (connection) => connection.authType === "apikey",
  ),
);
const selectedUnboundConnections = computed(() =>
  selectedConnections.value.filter(
    (connection) =>
      (connection.data as Record<string, unknown>)?.inviteBound !== true,
  ),
);

// --- Quota tracking (Quota Tracker-style bars on each connection card) ---
type QuotaEntry = {
  quotas: NormalizedQuotaRow[];
  plan?: string | null;
  message?: string | null;
  raw?: Record<string, unknown>;
};
const quotaData = ref<Record<string, QuotaEntry>>({});
const quotaLoading = ref<Record<string, boolean>>({});
const quotaErrors = ref<Record<string, string | null>>({});
const modelOrder = ref<Map<string, Map<string, number>>>(new Map());
const quotaAutoRefresh = ref(true);
const quotaCountdown = ref(60);
const quotaRefreshingAll = ref(false);
const hasHydratedAutoRefresh = ref(false);
const quotaTick = ref(0);
const codexResettingId = ref<string | null>(null);
const codexResetConfirm = ref<{
  connection: ProviderConnection;
  resetCreditCount: number;
} | null>(null);
const codexResetCredits = ref<{
  connection: ProviderConnection;
  loading: boolean;
  error: string | null;
  data: Record<string, any> | null;
} | null>(null);
const showPlanModelMap = ref(false);
const planModelTab = ref<"access" | "fallbacks">("access");
const codexPlanModelMapSaving = ref(false);
const codexPlanModelMap = computed<Record<string, string[]>>(() => {
  const raw = (settings.data.value as Record<string, any>)?.codex?.planModelMap;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string[]> = {};
  for (const [plan, models] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(models)) {
      result[plan] = models.filter((m): m is string => typeof m === "string");
    }
  }
  return result;
});
const planDraft = ref<Record<string, string[]>>({});
const resetPlanDraft = () => {
  planDraft.value = JSON.parse(JSON.stringify(codexPlanModelMap.value));
};
const planDraftDirty = computed(() => {
  const norm = (m: Record<string, string[]>) =>
    JSON.stringify(Object.keys(m).sort().map((k) => [k, [...m[k]].sort()]));
  return norm(planDraft.value) !== norm(codexPlanModelMap.value);
});
watch(codexPlanModelMap, resetPlanDraft, { immediate: true });
const codexPlanModelMapPlans = computed(() =>
  Object.keys(codexPlanModelMap.value).sort(),
);
const codexRegistryModelIds = computed(() =>
  (models.data.value?.data || [])
    .filter((m: any) => m.kind !== "image")
    .map((m: any) => String(m.id)),
);
async function saveCodexPlanModelMap(next: Record<string, string[]>) {
  codexPlanModelMapSaving.value = true;
  try {
    // The settings PATCH merges top-level keys only, so the whole `codex`
    // object must be re-sent to keep sibling keys (modelFallbacks, …).
    const currentCodex = ((settings.data.value as Record<string, any>)?.codex ||
      {}) as Record<string, unknown>;
    await api.settings.update({
      codex: { ...currentCodex, planModelMap: next },
    });
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  } finally {
    codexPlanModelMapSaving.value = false;
  }
}

// Per-model fallback chains: when a model is unavailable on every account
// that may serve it, the next model in its list is tried. Order is priority.
const codexModelFallbacks = computed<Record<string, string[]>>(() => {
  const raw = (settings.data.value as Record<string, any>)?.codex
    ?.modelFallbacks;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, string[]> = {};
  for (const [model, fallbacks] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (Array.isArray(fallbacks)) {
      result[model] = fallbacks.filter(
        (m): m is string => typeof m === "string",
      );
    }
  }
  return result;
});
const codexModelFallbackKeys = computed(() =>
  Object.keys(codexModelFallbacks.value).sort(),
);
const codexFallbackInputByModel = ref<Record<string, string>>({});
const codexNewFallbackModelInput = ref<string>("");
function codexFallbackSuggestions(model: string): string[] {
  const existing = new Set([
    model,
    ...(codexModelFallbacks.value[model] || []),
  ]);
  return codexRegistryModelIds.value.filter((id) => !existing.has(id));
}
// Candidate source models: registry models that do not yet have a chain.
const codexFallbackModelSuggestions = computed(() =>
  codexRegistryModelIds.value.filter((id) => !codexModelFallbacks.value[id]),
);
async function saveCodexModelFallbacks(next: Record<string, string[]>) {
  codexPlanModelMapSaving.value = true;
  try {
    const currentCodex = ((settings.data.value as Record<string, any>)?.codex ||
      {}) as Record<string, unknown>;
    await api.settings.update({
      codex: { ...currentCodex, modelFallbacks: next },
    });
    await queryClient.invalidateQueries({ queryKey: ["settings"] });
  } finally {
    codexPlanModelMapSaving.value = false;
  }
}
async function addCodexFallbackModel(model: string) {
  const trimmed = model.trim();
  if (!trimmed || codexModelFallbacks.value[trimmed]) {
    codexNewFallbackModelInput.value = "";
    return;
  }
  await saveCodexModelFallbacks({
    ...codexModelFallbacks.value,
    [trimmed]: [],
  });
  codexNewFallbackModelInput.value = "";
}
async function removeCodexFallbackModel(model: string) {
  const next = { ...codexModelFallbacks.value };
  delete next[model];
  await saveCodexModelFallbacks(next);
}
async function addFallbackToModel(model: string, fallback: string) {
  const trimmed = fallback.trim();
  const current = codexModelFallbacks.value[model] || [];
  if (!trimmed || trimmed === model || current.includes(trimmed)) {
    codexFallbackInputByModel.value = {
      ...codexFallbackInputByModel.value,
      [model]: "",
    };
    return;
  }
  await saveCodexModelFallbacks({
    ...codexModelFallbacks.value,
    [model]: [...current, trimmed],
  });
  codexFallbackInputByModel.value = {
    ...codexFallbackInputByModel.value,
    [model]: "",
  };
}
async function removeFallbackFromModel(model: string, fallback: string) {
  const current = codexModelFallbacks.value[model] || [];
  await saveCodexModelFallbacks({
    ...codexModelFallbacks.value,
    [model]: current.filter((m) => m !== fallback),
  });
}
async function moveFallback(model: string, index: number, direction: -1 | 1) {
  const current = [...(codexModelFallbacks.value[model] || [])];
  const target = index + direction;
  if (target < 0 || target >= current.length) return;
  const [item] = current.splice(index, 1);
  current.splice(target, 0, item);
  await saveCodexModelFallbacks({
    ...codexModelFallbacks.value,
    [model]: current,
  });
}
let quotaIntervalId: number | undefined;
let quotaCountdownId: number | undefined;

function codexResetCreditCount(connectionId: string): number {
  const value = (
    quotaData.value[connectionId]?.raw as Record<string, any> | undefined
  )?.resetCredits?.availableCount;
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

const codexCreditCounts = computed(() => {
  const map: Record<string, number> = {};
  for (const connection of allConnections.value)
    map[connection.id] = codexResetCreditCount(connection.id);
  return map;
});

const quotaColumns = computed(() => {
  const columns: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const connection of visibleConnections.value) {
    for (const quota of quotaData.value[connection.id]?.quotas || []) {
      const key = String(quota.modelKey || quota.name);
      if (!seen.has(key)) {
        seen.add(key);
        columns.push({ key, label: quota.name });
      }
    }
  }
  return columns;
});

function handleMoveUp(connectionId: string) {
  const index = allConnections.value.findIndex((c) => c.id === connectionId);
  if (index > 0) handleSwapPriority(index, index - 1);
}
function handleMoveDown(connectionId: string) {
  const index = allConnections.value.findIndex((c) => c.id === connectionId);
  if (index >= 0 && index < allConnections.value.length - 1)
    handleSwapPriority(index, index + 1);
}
function handleTested(connection: ProviderConnection) {
  refresh();
  refreshProviderQuota(connection.id, connection.provider);
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

async function fetchQuota(connectionId: string, provider: string) {
  quotaLoading.value = { ...quotaLoading.value, [connectionId]: true };
  quotaErrors.value = { ...quotaErrors.value, [connectionId]: null };
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
          quotaData.value = {
            ...quotaData.value,
            [connectionId]: { quotas: [], message },
          };
          return null;
        }
        throw error;
      });
    if (data === null) return;
    const order = modelOrder.value.get(provider);
    quotaData.value = {
      ...quotaData.value,
      [connectionId]: {
        quotas: parseQuotaData(provider, data, order),
        plan: ((data as Record<string, any>).plan as string) || null,
        message: ((data as Record<string, any>).message as string) || null,
        raw: data,
      },
    };
  } catch (error) {
    quotaErrors.value = {
      ...quotaErrors.value,
      [connectionId]:
        error instanceof Error ? error.message : "Failed to fetch quota",
    };
  } finally {
    quotaLoading.value = { ...quotaLoading.value, [connectionId]: false };
  }
}

async function fetchQuotaBulk(connectionIds: string[], force = false) {
  if (!connectionIds.length) return;
  const loadingState: Record<string, boolean> = {};
  const errorState: Record<string, string | null> = {};
  for (const id of connectionIds) {
    loadingState[id] = true;
    errorState[id] = null;
  }
  quotaLoading.value = { ...quotaLoading.value, ...loadingState };
  quotaErrors.value = { ...quotaErrors.value, ...errorState };
  try {
    const result = force
      ? await api.usage.batchRefresh(connectionIds)
      : await api.usage.batch(connectionIds);
    const dataUpdates: Record<string, QuotaEntry> = {};
    const errorUpdates: Record<string, string | null> = {};
    for (const id of connectionIds) {
      const entry = result.results[id];
      if (!entry) continue;
      if (entry.ok) {
        const data = entry.data as Record<string, any>;
        const provider =
          allConnections.value.find((c) => c.id === id)?.provider ||
          providerId.value;
        const order = modelOrder.value.get(provider);
        dataUpdates[id] = {
          quotas: parseQuotaData(provider, data, order),
          plan: (data.plan as string) || null,
          message: (data.message as string) || null,
          raw: data,
        };
      } else {
        errorUpdates[id] = entry.error;
      }
    }
    quotaData.value = { ...quotaData.value, ...dataUpdates };
    quotaErrors.value = { ...quotaErrors.value, ...errorUpdates };
  } finally {
    const doneState: Record<string, boolean> = {};
    for (const id of connectionIds) doneState[id] = false;
    quotaLoading.value = { ...quotaLoading.value, ...doneState };
  }
}

async function refreshProviderQuota(connectionId: string, provider: string) {
  await api.usage.refreshConnection(connectionId);
  await fetchQuota(connectionId, provider);
  await queryClient.invalidateQueries({ queryKey: ["provider-quota-summary"] });
}

async function refreshAllQuotas(force = false) {
  if (quotaRefreshingAll.value) return;
  const targets = allConnections.value;
  if (!targets.length) return;
  quotaRefreshingAll.value = true;
  quotaCountdown.value = 60;
  const tick = (quotaTick.value += 1);
  const claudeEvery = Math.round(
    CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS,
  );
  const shouldFetch = (conn: ProviderConnection) =>
    force || conn.provider !== "claude" || tick % claudeEvery === 0;
  try {
    const ids = targets.filter(shouldFetch).map((c) => c.id);
    await fetchQuotaBulk(ids, force);
    await queryClient.invalidateQueries({
      queryKey: ["provider-quota-summary"],
    });
  } finally {
    quotaRefreshingAll.value = false;
  }
}

function stopQuotaTimers() {
  if (quotaIntervalId) {
    window.clearInterval(quotaIntervalId);
    quotaIntervalId = undefined;
  }
  if (quotaCountdownId) {
    window.clearInterval(quotaCountdownId);
    quotaCountdownId = undefined;
  }
}
function startQuotaTimers() {
  stopQuotaTimers();
  quotaIntervalId = window.setInterval(
    () => refreshAllQuotas(),
    REFRESH_INTERVAL_MS,
  );
  quotaCountdownId = window.setInterval(() => {
    quotaCountdown.value =
      quotaCountdown.value <= 1 ? 60 : quotaCountdown.value - 1;
  }, 1000);
}
function onQuotaVisibilityChange() {
  if (document.hidden) stopQuotaTimers();
  else if (quotaAutoRefresh.value && hasHydratedAutoRefresh.value)
    startQuotaTimers();
}

async function handleCodexResetLimit(connectionId: string) {
  if (codexResettingId.value) return;
  codexResettingId.value = connectionId;
  quotaErrors.value = { ...quotaErrors.value, [connectionId]: null };
  try {
    await api.usage.codexResetCredits.post(connectionId);
    await queryClient.invalidateQueries({ queryKey: ["provider-connections"] });
    await refreshProviderQuota(connectionId, "codex");
  } catch (error) {
    quotaErrors.value = {
      ...quotaErrors.value,
      [connectionId]:
        error instanceof Error ? error.message : "Failed to reset Codex limit",
    };
  } finally {
    codexResettingId.value = null;
  }
}

async function handleClearCooldown(connectionId: string) {
  try {
    await api.usage.clearCooldown(connectionId);
    quotaErrors.value = { ...quotaErrors.value, [connectionId]: null };
    await queryClient.invalidateQueries({ queryKey: ["provider-connections"] });
    const conn = allConnections.value.find((c) => c.id === connectionId);
    if (conn) await refreshProviderQuota(connectionId, conn.provider);
  } catch (error) {
    quotaErrors.value = {
      ...quotaErrors.value,
      [connectionId]:
        error instanceof Error ? error.message : "Failed to clear wait window",
    };
  }
}

async function handleViewCodexResetCredits(connection: ProviderConnection) {
  codexResetCredits.value = {
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
    codexResetCredits.value = {
      connection,
      loading: false,
      error: null,
      data: { ...result, credits },
    };
  } catch (error) {
    codexResetCredits.value = {
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

// Fetch quota for connections as the list resolves; prune stale entries.
watch(
  allConnections,
  (rows, previous) => {
    const currentIds = new Set(rows.map((row) => row.id));
    const previousIds = new Set((previous || []).map((row) => row.id));
    const newIds = rows
      .filter(
        (row) =>
          !previousIds.has(row.id) &&
          !quotaData.value[row.id] &&
          !quotaLoading.value[row.id],
      )
      .map((row) => row.id);
    if (newIds.length) fetchQuotaBulk(newIds);
    if (Object.keys(quotaData.value).some((id) => !currentIds.has(id))) {
      const nextData: Record<string, QuotaEntry> = {};
      for (const id of Object.keys(quotaData.value))
        if (currentIds.has(id)) nextData[id] = quotaData.value[id];
      quotaData.value = nextData;
    }
  },
  { immediate: true },
);

onMounted(async () => {
  const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  quotaAutoRefresh.value = stored === null ? true : stored === "true";
  hasHydratedAutoRefresh.value = true;
  await loadModelOrder();
  if (quotaAutoRefresh.value) startQuotaTimers();
  document.addEventListener("visibilitychange", onQuotaVisibilityChange);
  await restoreConnectionTestJob();
});

onUnmounted(() => {
  stopQuotaTimers();
  stopConnectionTestJobPoll();
  document.removeEventListener("visibilitychange", onQuotaVisibilityChange);
});

watch(providerId, () => {
  connectionsPage.value = 1;
  selectedConnectionIds.value = [];
  void restoreConnectionTestJob();
});

watch(connectionsPage, () => {
  selectedConnectionIds.value = [];
});

watch(quotaAutoRefresh, (value) => {
  if (!hasHydratedAutoRefresh.value) return;
  localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(value));
  if (value) startQuotaTimers();
  else stopQuotaTimers();
});

async function refresh() {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["provider-connections", providerId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["provider-models", providerId],
    }),
    queryClient.invalidateQueries({ queryKey: ["custom-models"] }),
    queryClient.invalidateQueries({ queryKey: ["disabled-models"] }),
    queryClient.invalidateQueries({ queryKey: ["model-aliases"] }),
    queryClient.invalidateQueries({ queryKey: ["model-capability-overrides"] }),
  ]);
}

async function updateSettings(patch: Record<string, unknown>) {
  // v1 PATCHes only the changed keys; the backend merges into stored settings.
  await api.settings.update(patch);
  await queryClient.invalidateQueries({ queryKey: ["settings"] });
}

// Writes one provider's providerStrategies entry and keeps its other keys.
// An entry with no keys left is removed.
async function updateProviderStrategy(
  change: (entry: Record<string, unknown>) => void,
) {
  const current = {
    ...((settings.data.value?.providerStrategies as
      Record<string, Record<string, unknown>> | undefined) || {}),
  };
  const entry = { ...(current[providerId.value] || {}) };
  change(entry);
  if (Object.keys(entry).length === 0) delete current[providerId.value];
  else current[providerId.value] = entry;
  await updateSettings({ providerStrategies: current });
}

async function handleRoundRobinToggle(enabled: boolean) {
  await updateProviderStrategy((entry) => {
    if (!enabled) {
      delete entry.fallbackStrategy;
      delete entry.stickyRoundRobinLimit;
      return;
    }
    entry.fallbackStrategy = "round-robin";
    if (String(stickyLimit.value) !== "")
      entry.stickyRoundRobinLimit = Number(stickyLimit.value) || 1;
  });
}

async function handleStickyLimitChange(value: string) {
  await updateProviderStrategy((entry) => {
    entry.fallbackStrategy = "round-robin";
    entry.stickyRoundRobinLimit = Number(value) || 1;
  });
}

// Session affinity is on unless explicitly turned off.
const sessionAffinityOn = computed(
  () => providerSettings.value.sessionAffinity !== false,
);

async function handleSessionAffinityToggle(enabled: boolean) {
  await updateProviderStrategy((entry) => {
    if (enabled) delete entry.sessionAffinity;
    else entry.sessionAffinity = false;
  });
}

async function handleMaxInFlightChange(value: string) {
  const limit = Math.floor(Number(value));
  await updateProviderStrategy((entry) => {
    if (Number.isFinite(limit) && limit >= 1)
      entry.maxInFlightPerConnection = limit;
    else delete entry.maxInFlightPerConnection;
  });
}

async function handleThinkingModeChange(mode: string) {
  thinkingMode.value = mode;
  const current = {
    ...((settings.data.value?.providerThinking as
      Record<string, unknown> | undefined) || {}),
  };
  if (!mode || mode === "auto") delete current[providerId.value];
  else current[providerId.value] = { mode };
  await updateSettings({ providerThinking: current });
}

async function saveCodebuddyPriorityMeter(next: string) {
  const value = next.trim() === "" ? null : next.trim();
  codebuddyPrioritySaving.value = true;
  try {
    await updateSettings({
      codebuddyIntlCli: {
        priorityMeter: value,
        exhaustedExcludedModels: codebuddyExcludedModels.value,
      },
    });
    codebuddyPriorityMeter.value = value;
  } catch {
    /* keep prior value so the UI reflects on-disk state */
  } finally {
    codebuddyPrioritySaving.value = false;
  }
}

async function saveCodebuddyExcludedModels(next: string[]) {
  const value = next.map((model) => model.trim()).filter(Boolean);
  codebuddyExcludedSaving.value = true;
  try {
    await updateSettings({
      codebuddyIntlCli: {
        priorityMeter: codebuddyPriorityMeter.value,
        exhaustedExcludedModels: value,
      },
    });
    codebuddyExcludedModels.value = value;
  } catch {
    /* keep prior value so the UI reflects on-disk state */
  } finally {
    codebuddyExcludedSaving.value = false;
  }
}

function addCodebuddyExcludedModel() {
  const value = codebuddyExcludedDraft.value.trim();
  if (!value || codebuddyExcludedModels.value.includes(value)) return;
  codebuddyExcludedDraft.value = "";
  void saveCodebuddyExcludedModels([...codebuddyExcludedModels.value, value]);
}

function removeCodebuddyExcludedModel(model: string) {
  void saveCodebuddyExcludedModels(
    codebuddyExcludedModels.value.filter((entry) => entry !== model),
  );
}

function selectThinkingMode(value: string | number) {
  void handleThinkingModeChange(String(value));
}

async function saveAutoPing(next: {
  enabled: boolean;
  connections: Record<string, boolean>;
}) {
  if (!autoPingKey.value) return;
  const current =
    (settings.data.value as Record<string, unknown> | undefined)?.[
      autoPingKey.value
    ] || {};
  await updateSettings({
    [autoPingKey.value]: { ...(current as Record<string, unknown>), ...next },
  });
}

function triggerOAuthConnection() {
  if (providerId.value === "antigravity" && typeof window !== "undefined") {
    const confirmed =
      window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
    if (!confirmed) {
      showAgRiskModal.value = true;
      return;
    }
  }
  showOAuthModal.value = true;
}

function triggerApiKeyConnection() {
  addConnectionError.value = "";
  showAddApiKeyModal.value = true;
}

function triggerAddConnection() {
  if (isOAuth.value) {
    triggerOAuthConnection();
    return;
  }
  triggerApiKeyConnection();
}

async function exportSelectedCodexAccounts() {
  try {
    const accounts = await api.providers.exportCodexAccounts(
      selectedActiveCodexOAuthConnections.value.map(
        (connection) => connection.id,
      ),
    );
    const file = new Blob([JSON.stringify(accounts, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `codex-active-accounts-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : "Unable to export Codex accounts",
    );
  }
}

async function exportSelectedQoderPats() {
  try {
    const pats = await api.providers.exportQoderPats(
      selectedActiveQoderOAuthConnections.value.map(
        (connection) => connection.id,
      ),
    );
    const file = new Blob([`${pats.trim()}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qoder-selected-pats-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : "Unable to export Qoder Personal Access Tokens",
    );
  }
}

async function exportSelectedCodebuddyIntlCliTokens() {
  try {
    const tokens = await api.providers.exportCodebuddyIntlCliTokens(
      selectedActiveCodebuddyIntlConnections.value.map(
        (connection) => connection.id,
      ),
    );
    const file = new Blob([tokens.endsWith("\n") ? tokens : `${tokens}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `codebuddy-intl-cli-tokens-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : "Unable to export CodeBuddy Intl CLI tokens",
    );
  }
}

async function exportSelectedApiKeys() {
  try {
    const keys = await api.providers.exportApiKeys(
      selectedApiKeyConnections.value.map((connection) => connection.id),
    );
    const file = new Blob([keys.endsWith("\n") ? keys : `${keys}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${providerId.value}-api-keys-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(
      error instanceof Error ? error.message : "Unable to export API keys",
    );
  }
}

async function exportAlimsApiKeys() {
  try {
    const keys = await api.providers.exportAlimsApiKeys();
    const file = new Blob([keys.endsWith("\n") ? keys : `${keys}\n`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `alibaba-studio-api-keys-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : "Unable to export Alibaba Studio API keys",
    );
  }
}

function handleAgRiskConfirm() {
  if (typeof window !== "undefined")
    window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
  showAgRiskModal.value = false;
  if (isOAuth.value) {
    showOAuthModal.value = true;
    return;
  }
  triggerApiKeyConnection();
}

async function handleExportGrokCli() {
  addConnectionError.value = "";
  exportingGrokCli.value = true;
  try {
    const data = await api.providers.exportGrokCli();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `grok-cli-accounts-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    addConnectionError.value =
      err instanceof Error ? err.message : "Export failed";
  } finally {
    exportingGrokCli.value = false;
  }
}

async function handleSaveApiKey(formData: Record<string, unknown>) {
  addConnectionError.value = "";
  try {
    const result = await api.providers.create({
      provider: providerId.value,
      ...formData,
    });
    if (!result?.id) throw new Error("Failed to save connection");
    await refresh();
    showAddApiKeyModal.value = false;
  } catch (error) {
    addConnectionError.value =
      error instanceof Error ? error.message : "Failed to save connection";
  }
}

async function handleUpdateConnection(updates: Record<string, unknown>) {
  if (!editingConnection.value) return;
  try {
    await api.providers.update(editingConnection.value.id, updates);
    await refresh();
    showEditModal.value = false;
  } catch {
    /* v1 logs and keeps the modal open */
  }
}

async function handleUpdateConnectionStatus(id: string, isActive: boolean) {
  try {
    await api.providers.update(id, { isActive });
    await refresh();
  } catch {
    /* ignore */
  }
}

async function handleSwapPriority(index1: number, index2: number) {
  if (
    index1 < 0 ||
    index2 < 0 ||
    index1 >= allConnections.value.length ||
    index2 >= allConnections.value.length
  )
    return;
  const a = allConnections.value[index1];
  const b = allConnections.value[index2];
  try {
    await Promise.all([
      api.providers.update(a.id, { priority: index2 }),
      api.providers.update(b.id, { priority: index1 }),
    ]);
  } finally {
    await refresh();
  }
}

function toggleSelectConnection(connectionId: string) {
  selectedConnectionIds.value = selectedConnectionIds.value.includes(
    connectionId,
  )
    ? selectedConnectionIds.value.filter((id) => id !== connectionId)
    : [...selectedConnectionIds.value, connectionId];
}
function toggleSelectAllConnections() {
  selectedConnectionIds.value = allSelected.value
    ? selectedConnectionIds.value.filter(
        (id) => !visibleConnections.value.some((c) => c.id === id),
      )
    : [
        ...new Set([
          ...selectedConnectionIds.value,
          ...visibleConnections.value.map((c) => c.id),
        ]),
      ];
}

function handleDelete(id: string) {
  confirmState.value = {
    title: "Delete Connection",
    message: "Delete this connection?",
    confirmText: "Delete",
    onConfirm: async () => {
      confirmState.value = null;
      try {
        await api.providers.remove(id);
        await refresh();
      } catch {
        /* ignore */
      }
    },
  };
}

function handleBulkDelete() {
  const count = selectedConnectionIds.value.length;
  if (!count) return;
  confirmState.value = {
    title: `Delete ${count} Connection${count > 1 ? "s" : ""}`,
    message: `Delete ${count} connection${count > 1 ? "s" : ""}? This cannot be undone.`,
    confirmText: "Delete",
    onConfirm: async () => {
      confirmState.value = null;
      let failed = 0;
      const idsToDelete = [...selectedConnectionIds.value];
      for (const id of idsToDelete) {
        try {
          await api.providers.remove(id);
        } catch {
          failed += 1;
        }
      }
      selectedConnectionIds.value = [];
      await refresh();
      if (failed > 0)
        window.alert(
          `Deleted ${idsToDelete.length - failed} connection(s), ${failed} failed.`,
        );
    },
  };
}

function openProbe407Confirm() {
  const ids = selectedConnectionIds.value;
  if (!ids.length) return;
  const stored = (settings.data.value as Record<string, any>)?.grokCli
    ?.probe407Model;
  probe407ModelInput.value = typeof stored === "string" ? stored : "";
  probe407TimeoutInput.value = String(PROBE407_DEFAULT_TIMEOUT_S);
  probe407ConcurrencyInput.value = String(PROBE407_DEFAULT_CONCURRENCY);
  showProbe407Confirm.value = true;
}

async function confirmProbe407() {
  showProbe407Confirm.value = false;
  if (probe407Running.value) return;
  const ids = selectedConnectionIds.value;
  if (!ids.length) return;
  const model = probe407ModelInput.value.trim();
  probe407Running.value = true;
  probe407Job.value = null;
  try {
    const job = await api.providers.grokCliProbe407.create(
      ids,
      model || undefined,
      Math.round(
        (Number(probe407TimeoutInput.value) || PROBE407_DEFAULT_TIMEOUT_S) *
          1000,
      ),
      Math.max(
        1,
        Math.floor(Number(probe407ConcurrencyInput.value)) ||
          PROBE407_DEFAULT_CONCURRENCY,
      ),
    );
    probe407Job.value = job;
    scheduleProbe407Poll();
  } catch (error) {
    window.alert(describeApiError(error));
  } finally {
    probe407Running.value = false;
  }
}

const bulkToggleRunning = ref(false);

const bulkActionItems = computed<DropdownMenuAction[]>(() => {
  const items: DropdownMenuAction[] = [];

  if (providerId.value === "grok-cli") {
    items.push({
      key: "probe-407",
      label: "Probe 407",
      disabled:
        probe407Running.value ||
        bulkToggleRunning.value ||
        bulkProbeRunning.value ||
        clearWaitRunning.value,
    });
  }

  if (providerId.value === "codebuddy-intl-cli") {
    items.push(
      {
        key: "bind-invite",
        label: "Bind Invite Code",
        disabled:
          bulkProbeRunning.value ||
          bulkToggleRunning.value ||
          probe407Running.value ||
          clearWaitRunning.value ||
          inviteBindRunning.value,
      },
      {
        key: "probe-on",
        label: "Probe On",
        disabled:
          bulkProbeRunning.value ||
          bulkToggleRunning.value ||
          probe407Running.value ||
          clearWaitRunning.value ||
          inviteBindRunning.value,
      },
      {
        key: "probe-off",
        label: "Probe Off",
        disabled:
          bulkProbeRunning.value ||
          bulkToggleRunning.value ||
          probe407Running.value ||
          clearWaitRunning.value ||
          inviteBindRunning.value,
      },
    );
  }

  if (selectedApiKeyConnections.value.length) {
    items.push({
      key: "export-api-keys",
      label: `Export API Keys (${selectedApiKeyConnections.value.length})`,
    });
  }

  if (activePools.value.length) {
    items.push({
      key: "apply-proxy",
      label: "Apply Proxy",
      disabled: bulkToggleRunning.value || bulkMaxInFlightRunning.value,
    });
  }

  items.push(
    {
      key: "max-in-flight",
      label: "Set Max Concurrent",
      disabled: bulkToggleRunning.value || bulkMaxInFlightRunning.value,
    },
    {
      key: "clear-wait",
      label: `Clear wait (${selectedWaitingConnections.value.length})`,
      disabled:
        !selectedWaitingConnections.value.length ||
        clearWaitRunning.value ||
        bulkToggleRunning.value ||
        bulkProbeRunning.value ||
        probe407Running.value,
    },
    {
      key: "set-active",
      label: "Set Active",
      disabled:
        bulkToggleRunning.value ||
        bulkProbeRunning.value ||
        probe407Running.value ||
        clearWaitRunning.value,
    },
    {
      key: "set-inactive",
      label: "Set Inactive",
      disabled:
        bulkToggleRunning.value ||
        bulkProbeRunning.value ||
        probe407Running.value ||
        clearWaitRunning.value,
    },
  );

  return items;
});

async function handleBulkAction(key: string) {
  switch (key) {
    case "probe-407":
      openProbe407Confirm();
      break;
    case "bind-invite":
      openInviteBind({ ids: [...selectedConnectionIds.value] });
      break;
    case "probe-on":
      await handleBulkProbeToggle(true);
      break;
    case "probe-off":
      await handleBulkProbeToggle(false);
      break;
    case "clear-wait":
      await handleBulkClearWait();
      break;
    case "export-api-keys":
      await exportSelectedApiKeys();
      break;
    case "apply-proxy":
      showBulkProxyModal.value = true;
      break;
    case "max-in-flight":
      showBulkMaxInFlightModal.value = true;
      break;
    case "set-active":
      await handleBulkSetActive(true);
      break;
    case "set-inactive":
      await handleBulkSetActive(false);
      break;
  }
}

async function handleBulkMaxInFlight(limit: number | null) {
  const ids = selectedConnectionIds.value;
  if (!ids.length || bulkMaxInFlightRunning.value) return;
  bulkMaxInFlightRunning.value = true;
  let failed = 0;
  try {
    const results = await Promise.allSettled(
      ids.map((id) => api.providers.update(id, { maxInFlight: limit })),
    );
    for (const r of results) if (r.status === "rejected") failed += 1;
    showBulkMaxInFlightModal.value = false;
    await refresh();
    if (failed > 0) {
      window.alert(
        `Updated ${ids.length - failed} connection(s), ${failed} failed.`,
      );
    }
  } finally {
    bulkMaxInFlightRunning.value = false;
  }
}

async function handleBulkSetActive(isActive: boolean) {
  const ids = selectedConnectionIds.value;
  if (!ids.length || bulkToggleRunning.value) return;
  bulkToggleRunning.value = true;
  let failed = 0;
  try {
    const results = await Promise.allSettled(
      ids.map((id) => api.providers.update(id, { isActive })),
    );
    for (const r of results) if (r.status === "rejected") failed += 1;
    selectedConnectionIds.value = [];
    await refresh();
    if (failed > 0) {
      window.alert(
        `Updated ${ids.length - failed} connection(s), ${failed} failed.`,
      );
    }
  } finally {
    bulkToggleRunning.value = false;
  }
}

async function handleBulkClearWait() {
  if (clearWaitRunning.value) return;
  const ids = selectedWaitingConnections.value.map((c) => c.id);
  if (!ids.length) return;
  clearWaitRunning.value = true;
  let failed = 0;
  try {
    const results = await Promise.allSettled(
      ids.map((id) => api.usage.clearCooldown(id)),
    );
    for (const r of results) if (r.status === "rejected") failed += 1;
    await refresh();
  } finally {
    clearWaitRunning.value = false;
  }
  if (failed > 0) {
    window.alert(
      `Cleared wait for ${ids.length - failed} connection(s), ${failed} failed.`,
    );
  }
}

function openInviteBind(opts: { ids: string[] }) {
  if (inviteBindRunning.value) return;
  const unboundIds = opts.ids.filter((id) => {
    const conn = allConnections.value.find((c) => c.id === id);
    return conn && (conn.data as Record<string, unknown>)?.inviteBound !== true;
  });
  if (!unboundIds.length) {
    window.alert("All selected connections already have an invite code bound.");
    return;
  }
  inviteBindIds.value = unboundIds;
  const continuing = unboundIds
    .map((id) => allConnections.value.find((c) => c.id === id))
    .find((c) => (c?.data as Record<string, unknown> | undefined)?.inviteChain &&
      typeof (c!.data as Record<string, unknown>).inviteChain === "object" &&
      ((c!.data as Record<string, unknown>).inviteChain as { status?: string })?.status === "failed");
  inviteBindCode.value = String(
    ((continuing?.data as Record<string, unknown> | undefined)?.inviteChain as { inviteCode?: string } | undefined)?.inviteCode || "",
  );
  inviteBindProxyPoolId.value = "";
  showInviteBindModal.value = true;
}

function chainResultMessage(result: {
  ok: boolean;
  step: string;
  error?: string;
  steps: Array<{ step: string; ok: boolean; error?: string | null }>;
}): string {
  if (result.ok) {
    const done = result.steps.filter((s) => s.ok).map((s) => s.step);
    return done.length ? `Invite chain completed: ${done.join(" → ")}.` : "Invite chain completed.";
  }
  return `Chain failed at ${result.step}: ${result.error ?? "unknown error"}`;
}

function connectionLabelById(id: string): string {
  const conn = allConnections.value.find((c) => c.id === id);
  return conn?.name || conn?.email || id;
}

async function confirmInviteBind() {
  const ids = inviteBindIds.value;
  const code = inviteBindCode.value.trim();
  if (!ids.length || !code || inviteBindRunning.value) return;
  inviteBindRunning.value = true;
  try {
    const proxyChoice = inviteBindProxyPoolId.value;
    const proxyPoolId =
      proxyChoice === "" || proxyChoice === "__keep__"
        ? undefined
        : proxyChoice === "__none__"
          ? null
          : proxyChoice;
    if (ids.length === 1) {
      const result = await api.usage.codebuddyInvite.chain(ids[0], code, proxyPoolId);
      window.alert(chainResultMessage(result));
    } else {
      const result = await api.usage.codebuddyInvite.chainBulk(ids, code, proxyPoolId);
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        window.alert(`Invite chain completed on ${result.success} connection(s).`);
      } else {
        const breakdown = failed
          .slice(0, 10)
          .map((r) => `${connectionLabelById(r.connectionId)}: ${r.step} — ${r.error ?? "unknown error"}`)
          .join("\n");
        window.alert(
          `Completed ${result.success}, failed ${result.failed}.\n\n${breakdown}${failed.length > 10 ? `\n… and ${failed.length - 10} more` : ""}`,
        );
      }
    }
    showInviteBindModal.value = false;
    inviteBindIds.value = [];
    inviteBindCode.value = "";
    inviteBindProxyPoolId.value = "";
    await refresh();
  } catch (error) {
    window.alert(describeApiError(error));
  } finally {
    inviteBindRunning.value = false;
  }
}

const bulkProbeRunning = ref(false);
async function handleBulkProbeToggle(enabled: boolean) {
  if (bulkProbeRunning.value) return;
  const ids = selectedConnectionIds.value;
  if (!ids.length) return;
  bulkProbeRunning.value = true;
  try {
    const currentSettings = await api.settings.get();
    const probeConfig =
      (currentSettings.codebuddyIntlCliDailyProbe as {
        connections?: Record<string, boolean>;
      }) || {};
    const connections = { ...(probeConfig.connections || {}) };
    for (const id of ids) {
      connections[id] = enabled;
    }
    await api.settings.update({
      codebuddyIntlCliDailyProbe: {
        ...probeConfig,
        connections,
      },
    });
    selectedConnectionIds.value = [];
    await refresh();
    window.alert(
      `${enabled ? "Enabled" : "Disabled"} probe for ${ids.length} connection(s).`,
    );
  } catch (error) {
    window.alert(describeApiError(error));
  } finally {
    bulkProbeRunning.value = false;
  }
}

function scheduleProbe407Poll() {
  if (probe407PollTimer) window.clearInterval(probe407PollTimer);
  probe407PollTimer = window.setInterval(async () => {
    const jobId = probe407Job.value?.jobId;
    if (!jobId) return;
    try {
      const job = await api.providers.grokCliProbe407.get(jobId);
      probe407Job.value = job;
      if (job.status === "completed" || job.status === "failed") {
        if (probe407PollTimer) window.clearInterval(probe407PollTimer);
        probe407PollTimer = undefined;
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ["grok-cli-damaged"] }),
        ]);
      }
    } catch {
      if (probe407PollTimer) window.clearInterval(probe407PollTimer);
      probe407PollTimer = undefined;
    }
  }, 2000);
}

const damagedProbe407Items = computed(() =>
  (probe407Job.value?.result?.items || []).filter(
    (item) => item.status === "damaged",
  ),
);
const probe407Finished = computed(() =>
  ["completed", "failed"].includes(probe407Job.value?.status || ""),
);

// The backend decides which accounts are damaged and deletes them. The page only asks for the count.
const damagedQuery = useQuery({
  queryKey: ["grok-cli-damaged"],
  queryFn: api.providers.grokCliDamaged.list,
  enabled: computed(() => providerId.value === "grok-cli"),
  refetchInterval: 15_000,
});
const damagedCount = computed(() => damagedQuery.data.value?.ids.length ?? 0);
const deletingDamaged = ref(false);

function handleDeleteDamaged() {
  if (deletingDamaged.value) return;
  confirmState.value = {
    title: "Delete Damaged Accounts",
    message: damagedCount.value
      ? `Delete ${damagedCount.value} account(s) marked damaged by Probe 407? This cannot be undone.`
      : "No account is marked damaged right now. Run Probe 407 first to find damaged accounts.",
    confirmText: damagedCount.value
      ? `Delete ${damagedCount.value}`
      : "Delete none",
    onConfirm: async () => {
      confirmState.value = null;
      if (!damagedCount.value) return;
      deletingDamaged.value = true;
      try {
        const result = await api.providers.grokCliDamaged.removeAll();
        const removed = new Set(result.deleted);
        selectedConnectionIds.value = selectedConnectionIds.value.filter(
          (id) => !removed.has(id),
        );
        closeProbe407Modal();
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ["grok-cli-damaged"] }),
        ]);
        if (result.failed.length > 0)
          window.alert(
            `Deleted ${result.deleted.length} account(s), ${result.failed.length} failed.`,
          );
      } catch (error) {
        window.alert(describeApiError(error));
      } finally {
        deletingDamaged.value = false;
      }
    },
  };
}

function closeProbe407Modal() {
  if (probe407PollTimer) window.clearInterval(probe407PollTimer);
  probe407PollTimer = undefined;
  probe407Job.value = null;
}

onUnmounted(() => {
  if (probe407PollTimer) window.clearInterval(probe407PollTimer);
});

async function handleUpdateProxy(
  connectionId: string,
  proxyPoolId: string | null,
) {
  try {
    await api.providers.update(connectionId, { proxyPoolId });
    await refresh();
  } catch {
    /* ignore */
  }
}

async function applyProxyAssignments(
  assignments: Array<{ connectionId: string; proxyPoolId: string | null }>,
) {
  let failed = 0;
  for (const assignment of assignments) {
    try {
      await api.providers.update(assignment.connectionId, {
        proxyPoolId: assignment.proxyPoolId,
      });
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) window.alert(`Updated with ${failed} failed request(s).`);
  await refresh();
  showBulkProxyModal.value = false;
}

function applyConnectionTestJob(job: ConnectionTestJob) {
  const stillWorking =
    job.status === "queued" ||
    job.status === "running" ||
    job.items.some((item) => item.status === "testing");
  oneByOneJobId.value = job.id;
  oneByOneRunning.value = stillWorking;
  oneByOneStopping.value =
    stillWorking &&
    (job.status === "cancelled" ||
      job.items.some((item) => item.status === "cancelled"));
  oneByOneCurrentConnectionId.value = job.currentConnectionId;
  oneByOneResults.value = Object.fromEntries(
    job.items.map((item) => [
      item.connectionId,
      {
        state: item.status,
        error: item.error,
      } as OneByOneStatus,
    ]),
  );
  oneByOneSummary.value = {
    total: job.total,
    completed: job.completed,
    passed: job.passed,
    failed: job.failed,
    stopped: job.status === "cancelled",
  };
}

function stopConnectionTestJobPoll() {
  if (oneByOnePollTimer !== undefined) window.clearTimeout(oneByOnePollTimer);
  oneByOnePollTimer = undefined;
}

function scheduleConnectionTestJobPoll() {
  stopConnectionTestJobPoll();
  if (!oneByOneJobId.value || !oneByOneRunning.value) return;
  oneByOnePollTimer = window.setTimeout(() => {
    void pollConnectionTestJob();
  }, 400);
}

async function pollConnectionTestJob() {
  if (!oneByOneJobId.value) return;
  try {
    const job = await api.providers.getTestJob(oneByOneJobId.value);
    applyConnectionTestJob(job);
    if (oneByOneRunning.value) scheduleConnectionTestJobPoll();
    else await refresh();
  } catch {
    scheduleConnectionTestJobPoll();
  }
}

function resetConnectionTestJobState() {
  stopConnectionTestJobPoll();
  oneByOneJobId.value = null;
  oneByOneRunning.value = false;
  oneByOneStopping.value = false;
  oneByOneCurrentConnectionId.value = null;
  oneByOneResults.value = {};
  oneByOneSummary.value = null;
}

async function restoreConnectionTestJob() {
  resetConnectionTestJobState();
  if (!providerId.value) return;
  try {
    const job = await api.providers.latestTestJob(providerId.value);
    applyConnectionTestJob(job);
    if (oneByOneRunning.value) scheduleConnectionTestJobPoll();
  } catch {
    /* no stored job for this provider */
  }
}

async function handleRunOneByOneTest() {
  if (oneByOneRunning.value || !allConnections.value.length) return;
  try {
    const job = await api.providers.createTestJob({
      providerId: providerId.value,
      delayMs: ONE_BY_ONE_DELAY_MS,
    });
    applyConnectionTestJob(job);
    scheduleConnectionTestJobPoll();
  } catch (error) {
    window.alert(describeApiError(error));
  }
}

async function handleStopOneByOneTest() {
  if (!oneByOneRunning.value || !oneByOneJobId.value) return;
  oneByOneStopping.value = true;
  try {
    const job = await api.providers.cancelTestJob(oneByOneJobId.value);
    applyConnectionTestJob(job);
    if (oneByOneRunning.value) scheduleConnectionTestJobPoll();
  } catch (error) {
    oneByOneStopping.value = false;
    window.alert(describeApiError(error));
  }
}

async function handleSetAlias(
  modelId: string,
  aliasInput: string | null,
  providerAliasOverride?: string,
) {
  const fullModel = `${providerAliasOverride || providerStorageAlias.value}/${modelId}`;
  const alias = aliasInput ?? window.prompt("Set alias", "");
  if (alias === null) return;
  try {
    await api.models.saveAlias(alias.trim(), fullModel);
    await queryClient.invalidateQueries({ queryKey: ["model-aliases"] });
  } catch (error) {
    window.alert(
      error instanceof Error ? error.message : "Failed to set alias",
    );
  }
}

function aliasFor(modelId: string): string | undefined {
  const fullModel = `${providerStorageAlias.value}/${modelId}`;
  const oldFormatModel = `${providerId.value}/${modelId}`;
  return Object.entries(aliasMap.value).find(
    ([, value]) => value === fullModel || value === oldFormatModel,
  )?.[0];
}

function handleDeleteAlias(alias: string | undefined) {
  if (!alias) return;
  confirmState.value = {
    title: "Delete Model Alias",
    message: `Delete the ${alias} alias? This action cannot be undone.`,
    confirmText: "Delete",
    onConfirm: async () => {
      confirmState.value = null;
      try {
        await api.models.deleteAlias(alias);
        await queryClient.invalidateQueries({ queryKey: ["model-aliases"] });
      } catch {
        /* ignore */
      }
    },
  };
}

async function handleAddCustomModel(
  modelId: string,
  providerAliasOverride?: string,
) {
  try {
    await api.models.saveCustom({
      providerAlias: providerAliasOverride || providerStorageAlias.value,
      id: modelId,
      type: "llm",
    });
    await refresh();
  } catch (error) {
    window.alert(
      error instanceof Error ? error.message : "Failed to add custom model",
    );
  }
}

function handleDeleteCustomModel(
  modelId: string,
  providerAliasOverride?: string,
) {
  confirmState.value = {
    title: "Delete Custom Model",
    message: `Delete the ${modelId} custom model? This action cannot be undone.`,
    confirmText: "Delete",
    onConfirm: async () => {
      confirmState.value = null;
      try {
        await api.models.removeCustom(
          modelId,
          providerAliasOverride || providerStorageAlias.value,
        );
        await refresh();
      } catch {
        /* ignore */
      }
    },
  };
}

function handleDisableModel(modelId: string) {
  confirmState.value = {
    title: "Disable Model",
    message: `Disable ${modelId}? Requests will stop using this model until you restore it.`,
    confirmText: "Disable",
    onConfirm: async () => {
      confirmState.value = null;
      try {
        await api.models.disable(providerStorageAlias.value, [modelId]);
        await queryClient.invalidateQueries({ queryKey: ["disabled-models"] });
      } catch {
        /* ignore */
      }
    },
  };
}

async function handleEnableModel(modelId: string) {
  try {
    await api.models.enable(providerStorageAlias.value, modelId);
    await queryClient.invalidateQueries({ queryKey: ["disabled-models"] });
  } catch {
    /* ignore */
  }
}

function handleDisableAll(ids: string[]) {
  if (!ids.length) return;
  confirmState.value = {
    title: "Disable All Models",
    message: `Disable all ${ids.length} model(s)?`,
    confirmText: "Disable",
    onConfirm: async () => {
      confirmState.value = null;
      try {
        await api.models.disable(providerStorageAlias.value, ids);
        await queryClient.invalidateQueries({ queryKey: ["disabled-models"] });
      } catch {
        /* ignore */
      }
    },
  };
}

async function handleEnableAll() {
  try {
    await api.models.enable(providerStorageAlias.value);
    await queryClient.invalidateQueries({ queryKey: ["disabled-models"] });
  } catch {
    /* ignore */
  }
}

async function handleTestModel(modelId: string) {
  if (testingModelIds.value.has(modelId)) return;
  testingModelIds.value = new Set(testingModelIds.value).add(modelId);
  try {
    const result = await api.models.test(
      `${providerStorageAlias.value}/${modelId}`,
      "llm",
    );
    modelTestResults.value = {
      ...modelTestResults.value,
      [modelId]: result.ok ? "ok" : "error",
    };
    modelsTestError.value = result.ok
      ? ""
      : result.error || "Model not reachable";
  } catch (reason) {
    modelTestResults.value = { ...modelTestResults.value, [modelId]: "error" };
    modelsTestError.value = describeApiError(reason);
  } finally {
    const next = new Set(testingModelIds.value);
    next.delete(modelId);
    testingModelIds.value = next;
  }
}

async function handleImportModels() {
  if (importingModels.value) return;
  const activeConnection = allConnections.value.find(
    (c) => c.isActive !== false,
  );
  if (!activeConnection) {
    window.alert(`Please add an active ${providerName.value} connection first`);
    return;
  }
  importingModels.value = true;
  try {
    const result = await api.providers.models(activeConnection.id);
    const modelRows = (result.data || []) as Array<{
      id?: string;
      name?: string;
    }>;
    if (!modelRows.length) {
      window.alert("No models returned");
      return;
    }
    let importedCount = 0;
    for (const model of modelRows) {
      const modelId = model.id || model.name;
      if (!modelId) continue;
      const cleanModelId =
        providerId.value === "qoder"
          ? modelId.replace(/^qoder\//, "")
          : stripAlias(modelId);
      const alreadyExists =
        customModelRows.value.some((entry) => entry.id === cleanModelId) ||
        Object.values(aliasMap.value).includes(
          `${providerStorageAlias.value}/${cleanModelId}`,
        );
      if (alreadyExists) continue;
      await handleAddCustomModel(cleanModelId);
      importedCount += 1;
    }
    if (importedCount === 0)
      window.alert("All models already exist, no new models added");
    else window.alert(`Successfully added ${importedCount} models`);
  } catch (error) {
    window.alert(
      `Error fetching models: ${error instanceof Error ? error.message : error}`,
    );
  } finally {
    importingModels.value = false;
  }
}

async function handleUpdateNode(formData: Record<string, unknown>) {
  nodeFormError.value = "";
  try {
    await api.nodes.update(providerId.value, formData);
    await queryClient.invalidateQueries({ queryKey: ["provider-nodes"] });
    await refresh();
    showEditNodeModal.value = false;
  } catch (error) {
    nodeFormError.value = describeApiError(error);
  }
}

function openEditNode() {
  const node = providerNode.value;
  if (!node) return;
  Object.assign(nodeForm, {
    name: node.name || "",
    prefix: node.prefix || "",
    baseUrl: node.baseUrl || node.base_url || "",
    apiType: node.apiType || node.api_type || "chat",
    logo: node.logo || null,
  });
  nodeFormError.value = "";
  showEditNodeModal.value = true;
}

function handleDeleteNode() {
  confirmState.value = {
    title: "Delete Custom Provider",
    message: `Delete ${providerName.value}? Its connections are deleted too. This action cannot be undone.`,
    confirmText: "Delete",
    onConfirm: async () => {
      confirmState.value = null;
      try {
        await api.nodes.remove(providerId.value);
        router.push("/dashboard/providers");
      } catch {
        /* ignore */
      }
    },
  };
}

function capsFor(modelId: string): Record<string, unknown> | null {
  const resolved = getCapabilitiesForModel(
    providerStorageAlias.value,
    modelId,
  ) as unknown as Record<string, unknown>;
  const stored = capabilityOverrides.data.value?.overrides || {};
  const override =
    stored[`${providerStorageAlias.value}/${modelId}`] || stored[modelId] || {};
  return { ...resolved, ...override };
}

const headerIconFailed = ref(false);
watch([providerId, () => providerNode.value?.logo], () => {
  headerIconFailed.value = false;
});
const headerIconPath = computed(() => {
  if (providerNode.value?.logo) return providerNode.value.logo;
  if (isCompatible.value)
    return providerNode.value?.type === "anthropic-compatible"
      ? "/providers/anthropic-m.png"
      : providerNode.value?.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
  return providerLogo(providerId.value);
});

const compatibleEndpoint = computed(() => {
  const node = providerNode.value;
  if (!node) return null;
  const base = (node.baseUrl || node.base_url || "").replace(/\/$/, "");
  if (isAnthropicCompatible.value)
    return { label: "Anthropic compatible · Messages API", url: `${base}/messages` };
  const responses = (node.apiType || node.api_type) === "responses";
  return {
    label: `OpenAI compatible · ${responses ? "Responses API" : "Chat Completions"}`,
    url: `${base}/${responses ? "responses" : "chat/completions"}`,
  };
});

const knownProvider = computed(
  () =>
    Boolean(meta.value.name) ||
    isCompatible.value ||
    authModes.value.length > 0,
);
</script>

<template>
  <div
    v-if="connections.isPending.value && nodes.isPending.value"
    class="theme-v2 flex flex-col gap-6"
    role="status"
    aria-label="Loading provider"
  >
    <div class="flex items-center gap-3">
      <Skeleton class="size-12 rounded-lg" />
      <div class="space-y-2">
        <Skeleton class="h-6 w-48" />
        <Skeleton class="h-3.5 w-24" />
      </div>
    </div>
    <Skeleton class="h-32 rounded-[10px]" />
    <Skeleton class="h-64 rounded-[10px]" />
  </div>
  <div v-else-if="!knownProvider" class="theme-v2 py-20 text-center">
    <p class="text-muted-foreground">Provider not found</p>
    <RouterLink to="/dashboard/providers" class="mt-4 inline-block text-primary"
      >Back to Providers</RouterLink
    >
  </div>
  <div
    v-else
    class="theme-v2 flex min-w-0 flex-col gap-6 px-1 sm:gap-8 sm:px-0"
  >
    <!-- Header -->
    <div class="min-w-0">
      <RouterLink
        to="/dashboard/providers"
        class="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <span class="material-symbols-outlined text-lg">arrow_back</span>
        Back to Providers
      </RouterLink>
      <div
        class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex min-w-0 items-center gap-3 sm:gap-4">
          <div
            class="flex size-12 shrink-0 items-center justify-center rounded-lg"
            :style="{ backgroundColor: `${meta.color || '#888'}15` }"
          >
            <template v-if="providerId === 'zenmux'">
              <img
                src="/providers/zenmux-light.svg"
                :alt="providerName"
                class="max-h-12 max-w-12 rounded-lg object-contain dark:hidden"
              />
              <img
                src="/providers/zenmux-dark.svg"
                :alt="providerName"
                class="hidden max-h-12 max-w-12 rounded-lg object-contain dark:block"
              />
            </template>
            <img
              v-else-if="headerIconPath && !headerIconFailed"
              :src="headerIconPath"
              :alt="providerName"
              class="max-h-12 max-w-12 rounded-lg object-contain"
              @error="headerIconFailed = true"
            />
            <span
              v-else
              class="text-sm font-bold"
              :style="{ color: meta.color || '#888' }"
              >{{ meta.textIcon || providerId.slice(0, 2).toUpperCase() }}</span
            >
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-3">
              <h1
                class="truncate text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                {{ providerName }}
              </h1>
              <a
                v-if="
                  meta.notice?.apiKeyUrl || meta.notice?.signupUrl || meta.website
                "
                :href="
                  meta.notice?.apiKeyUrl || meta.notice?.signupUrl || meta.website
                "
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <span class="material-symbols-outlined text-sm">open_in_new</span>
                {{
                  meta.notice?.apiKeyUrl ? "Get API Key" : "Sign up / Learn more"
                }}
              </a>
            </div>
            <p class="text-muted-foreground">
              {{
                providerQuotaSummary.data.value?.totalConnectionCount ??
                allConnections.length
              }}
              connection{{
                (providerQuotaSummary.data.value?.totalConnectionCount ??
                  allConnections.length) === 1
                  ? ""
                  : "s"
              }}
            </p>
            <p
              v-if="compatibleEndpoint"
              class="mt-0.5 break-all text-xs text-muted-foreground"
            >
              {{ compatibleEndpoint.label }} ·
              <span class="font-mono">{{ compatibleEndpoint.url }}</span>
            </p>
          </div>
        </div>
        <div
          v-if="isCompatible"
          class="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center"
        >
          <Button variant="secondary" @click="openEditNode">
            <span class="material-symbols-outlined text-sm">edit</span> Edit
          </Button>
          <Button variant="secondary" @click="handleDeleteNode">
            <span class="material-symbols-outlined text-sm">delete</span> Delete
          </Button>
        </div>
      </div>
    </div>

    <!-- Summary metric cards -->
    <div v-if="allConnections.length" class="grid gap-3 sm:grid-cols-2">
      <div v-if="quotaSummary" class="rounded-[10px] border bg-card px-5 py-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs font-medium text-muted-foreground">
            Total Available
          </p>
          <span
            :class="
              cn(
                'size-2 rounded-full bg-primary',
                quotaTone === 'success' && 'bg-success',
                quotaTone === 'warning' && 'bg-warning',
                quotaTone === 'destructive' && 'bg-destructive',
              )
            "
          />
        </div>
        <p class="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
          {{ quotaSummary.value }}
        </p>
        <p
          v-if="remainingCreditBalance > 0"
          class="mt-1 text-xs font-medium text-muted-foreground tabular-nums"
        >
          {{ formatBalance(remainingCreditBalance) }}
          {{ remainingAmountUnit }} remaining
        </p>
        <p
          v-if="providerQuotaSummary.data.value"
          class="mt-1 text-xs text-muted-foreground tabular-nums"
        >
          dari {{ providerQuotaSummary.data.value.connectionsWithData }} /
          {{ providerQuotaSummary.data.value.connectionsTotal }} koneksi
        </p>
        <p class="mt-1 text-xs text-muted-foreground">{{ accountSummary }}</p>
        <p
          v-if="isCodexProvider && codexPlanCounts.length"
          class="mt-1 text-xs text-muted-foreground tabular-nums"
        >
          <template
            v-for="([plan, count], index) in codexPlanCounts"
            :key="plan"
            ><span v-if="index > 0"> · </span>{{ plan }} ×{{ count }}</template
          >
        </p>
        <div
          v-if="isCodexProvider"
          class="mt-3 space-y-2 border-t border-border/60 pt-3"
        >
          <Button
            size="sm"
            variant="secondary"
            class="w-full"
            @click="showPlanModelMap = true"
          >
            <span class="material-symbols-outlined text-[16px]">tune</span>
            Plan model map
            <span
              v-if="codexPlanModelMapPlans.length"
              class="text-[11px] text-muted-foreground"
              >{{ codexPlanModelMapPlans.length }} plan{{
                codexPlanModelMapPlans.length === 1 ? "" : "s"
              }}</span
            >
          </Button>
        </div>
        <div
          v-if="quotaMeters.length > 1"
          class="mt-4 space-y-3 border-t border-border/60 pt-3"
        >
          <div v-for="meter in quotaMeters" :key="meter.key" class="space-y-1">
            <div class="flex items-center justify-between gap-2 text-[11px]">
              <span class="truncate text-muted-foreground">{{
                meter.label
              }}</span>
              <span class="shrink-0 font-medium tabular-nums">
                <template v-if="meter.kind === 'balance'">
                  {{ formatBalance(meter.balance) }} {{ meter.unit }}
                </template>
                <template v-else>
                  {{ meter.remaining }}%
                  <span
                    v-if="meter.creditBalance !== null"
                    class="text-muted-foreground"
                  >
                    · {{ formatBalance(meter.creditBalance) }}
                    {{ meter.unit || remainingAmountUnit }} remaining
                  </span>
                </template>
              </span>
            </div>
            <div
              v-if="meter.kind === 'percentage'"
              class="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                class="h-full rounded-full bg-primary transition-all duration-300"
                :style="{ width: `${meter.remaining}%` }"
              />
            </div>
          </div>
        </div>
      </div>
      <div v-else class="rounded-[10px] border bg-card px-5 py-4">
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs font-medium text-muted-foreground">Accounts</p>
          <span class="size-2 rounded-full bg-primary" />
        </div>
        <p class="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
          {{
            providerId === "bitdeer"
              ? bitdeerAvailableCount
              : activeConnectionCount
          }}
          {{ providerId === "bitdeer" ? "available" : "active" }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          <template v-if="providerId === 'bitdeer'">
            {{ bitdeerExhaustedCount }} exhausted ·
            {{ inactiveConnectionCount }} inactive
          </template>
          <template v-else> {{ inactiveConnectionCount }} inactive </template>
        </p>
      </div>
      <AlimsModelAvailability
        v-if="providerId === 'alims-intl'"
        :provider-id="providerId"
        :models="alimsAvailabilityModels"
      />
    </div>

    <!-- Deprecated banner -->
    <div
      v-if="meta.deprecated"
      class="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2"
    >
      <span
        class="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-yellow-500"
        >warning</span
      >
      <p class="text-xs leading-relaxed text-red-600 dark:text-yellow-400">
        {{ meta.deprecationNotice }}
      </p>
    </div>

    <!-- Info notice banner -->
    <div
      v-if="meta.notice?.text && !meta.deprecated"
      class="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center"
    >
      <span class="material-symbols-outlined shrink-0 text-[16px] text-blue-500"
        >info</span
      >
      <p
        class="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400"
      >
        {{ meta.notice.text }}
      </p>
      <a
        v-if="meta.notice.apiKeyUrl"
        :href="meta.notice.apiKeyUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
      >
        Get API Key →
      </a>
    </div>

    <!-- Connections -->
    <NoAuthProxyCard
      v-if="isFreeNoAuth && !meta.optionalApiKey"
      :provider-id="providerId"
    />
    <Card v-else class="p-5 sm:p-6">
      <div
        class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <h2 class="text-lg font-semibold">Connections</h2>
        <div
          class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
        >
          <template v-if="allConnections.length">
            <Button
              v-if="
                providerId === 'codex' &&
                selectedActiveCodexOAuthConnections.length
              "
              size="icon"
              variant="secondary"
              title="Export selected active accounts"
              aria-label="Export selected active accounts"
              @click="exportSelectedCodexAccounts"
            >
              <span class="material-symbols-outlined text-[18px]"
                >download</span
              >
            </Button>
            <Button
              v-if="
                providerId === 'qoder' &&
                selectedActiveQoderOAuthConnections.length
              "
              size="icon"
              variant="secondary"
              title="Export selected Personal Access Tokens"
              aria-label="Export selected Personal Access Tokens"
              @click="exportSelectedQoderPats"
            >
              <span class="material-symbols-outlined text-[18px]"
                >download</span
              >
            </Button>
            <Button
              v-if="
                isCodebuddyIntlCli &&
                selectedActiveCodebuddyIntlConnections.length
              "
              size="icon"
              variant="secondary"
              title="Export selected refresh tokens as text"
              aria-label="Export selected CodeBuddy Intl CLI tokens"
              @click="exportSelectedCodebuddyIntlCliTokens"
            >
              <span class="material-symbols-outlined text-[18px]"
                >download</span
              >
            </Button>
            <Button
              v-if="providerId === 'alims-intl' && allConnections.length"
              size="icon"
              variant="secondary"
              title="Export all API keys"
              aria-label="Export all Alibaba Studio API keys"
              @click="exportAlimsApiKeys"
            >
              <span class="material-symbols-outlined text-[18px]"
                >download</span
              >
            </Button>
            <DropdownMenu
              v-if="selectedConnectionIds.length"
              :items="bulkActionItems"
              @select="handleBulkAction"
            />
            <Button
              v-if="selectedConnectionIds.length"
              variant="destructive"
              class="gap-1 px-2"
              :title="`Delete ${selectedConnectionIds.length} selected connections`"
              :aria-label="`Delete ${selectedConnectionIds.length} selected connections`"
              @click="handleBulkDelete"
            >
              <span class="material-symbols-outlined text-[18px]">delete</span>
              <span class="text-xs tabular-nums">{{
                selectedConnectionIds.length
              }}</span>
            </Button>
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-muted-foreground"
                >Round Robin</span
              >
              <Toggle
                :checked="roundRobinOn"
                @change="handleRoundRobinToggle"
              />
              <input
                v-if="roundRobinOn"
                v-model="stickyLimit"
                type="number"
                min="1"
                placeholder="1"
                class="w-14 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
                @change="handleStickyLimitChange(stickyLimit)"
              />
            </div>
            <div
              class="flex items-center gap-2"
              title="Keep each conversation and API key on the same account for prompt cache hits. A full account spills one request, then the conversation returns."
            >
              <span class="text-xs font-medium text-muted-foreground"
                >Session affinity</span
              >
              <Toggle
                :checked="sessionAffinityOn"
                @change="handleSessionAffinityToggle"
              />
            </div>
            <label
              class="flex items-center gap-2"
              title="Default maximum in-flight requests per connection. An account's own Max concurrent overrides it. Empty means no limit."
            >
              <span class="text-xs font-medium text-muted-foreground"
                >Max in-flight</span
              >
              <input
                v-model="maxInFlight"
                type="number"
                min="1"
                placeholder="No limit"
                aria-label="Maximum in-flight requests per connection"
                class="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
                @change="handleMaxInFlightChange(maxInFlight)"
              />
            </label>
            <Button
              v-if="isCodebuddyIntlCli"
              size="icon"
              variant="secondary"
              :title="`Priority meter: ${codebuddyPriorityMeter || 'Off'}`"
              aria-label="Priority meter"
              @click="showPriorityMeterModal = true"
            >
              <span class="material-symbols-outlined text-[18px]"
                >stacked_bar_chart</span
              >
            </Button>
            <Button
              v-if="providerId === 'grok-cli'"
              variant="destructive"
              class="gap-1 px-2"
              :disabled="deletingDamaged"
              :title="
                damagedCount
                  ? `Delete ${damagedCount} damaged accounts (Probe 407)`
                  : 'Delete damaged accounts (none marked yet)'
              "
              aria-label="Delete damaged accounts"
              @click="handleDeleteDamaged"
            >
              <span class="material-symbols-outlined text-[18px]"
                >delete_sweep</span
              >
              <span class="text-xs tabular-nums">{{ damagedCount }}</span>
            </Button>
            <Button
              size="icon"
              variant="secondary"
              :disabled="oneByOneRunning"
              :title="
                oneByOneRunning
                  ? 'Testing connections one by one'
                  : 'Test connections one by one'
              "
              :aria-label="
                oneByOneRunning
                  ? 'Testing connections one by one'
                  : 'Test connections one by one'
              "
              @click="handleRunOneByOneTest"
            >
              <span
                class="material-symbols-outlined text-[18px]"
                :class="{ 'animate-spin': oneByOneRunning }"
                >network_check</span
              >
            </Button>
            <Button
              v-if="oneByOneRunning"
              size="icon"
              variant="ghost"
              :disabled="oneByOneStopping"
              :title="oneByOneStopping ? 'Stopping tests' : 'Stop tests'"
              :aria-label="oneByOneStopping ? 'Stopping tests' : 'Stop tests'"
              @click="handleStopOneByOneTest"
            >
              <span class="material-symbols-outlined text-[18px]">stop</span>
            </Button>
            <div class="relative shrink-0">
              <Button
                size="icon"
                variant="secondary"
                :title="
                  quotaAutoRefresh
                    ? 'Disable quota auto-refresh'
                    : 'Enable quota auto-refresh'
                "
                :aria-label="
                  quotaAutoRefresh
                    ? 'Disable quota auto-refresh'
                    : 'Enable quota auto-refresh'
                "
                @click="quotaAutoRefresh = !quotaAutoRefresh"
              >
                <span
                  class="material-symbols-outlined text-[18px]"
                  :class="
                    quotaAutoRefresh ? 'text-primary' : 'text-muted-foreground'
                  "
                  >schedule</span
                >
              </Button>
              <span
                v-if="quotaAutoRefresh"
                class="pointer-events-none absolute -bottom-1 -right-1 min-w-[16px] rounded bg-primary px-1 text-center text-[9px] font-semibold leading-[14px] text-primary-foreground tabular-nums"
                >{{ quotaCountdown }}</span
              >
            </div>
            <Button
              size="icon"
              variant="secondary"
              :disabled="quotaRefreshingAll"
              title="Refresh all quotas"
              aria-label="Refresh all quotas"
              @click="refreshAllQuotas(true)"
            >
              <span
                class="material-symbols-outlined text-[18px]"
                :class="{ 'animate-spin': quotaRefreshingAll }"
                >refresh</span
              >
            </Button>
            <Button
              v-if="activePools.length"
              size="icon"
              variant="secondary"
              title="Apply proxy to connections"
              aria-label="Apply proxy to connections"
              @click="showBulkProxyModal = true"
            >
              <span class="material-symbols-outlined text-[18px]">lan</span>
            </Button>
          </template>
          <div
            v-if="allConnections.length && groupOptions.length"
            class="flex items-center gap-1.5"
          >
            <Select
              :model-value="groupFilter"
              :options="groupFilterOptions"
              title="Filter connections by group"
              class="h-8 w-auto min-w-32 text-xs"
              aria-label="Filter by group"
              @update:model-value="
                (value) => {
                  groupFilter = String(value || 'all');
                  connectionsPage = 1;
                }
              "
            />
          </div>
          <div
            v-if="allConnections.length"
            class="flex flex-wrap items-center gap-2 sm:ml-auto"
          >
            <Button
              v-if="providerId === 'codex'"
              variant="secondary"
              class="h-9"
              title="Bulk import codex accounts from JSON"
              @click="showBulkImport = 'codex'"
            >
              <span class="material-symbols-outlined text-sm"
                >playlist_add</span
              >
              Bulk Add
            </Button>
            <Button
              v-if="providerId === 'qoder'"
              variant="secondary"
              class="h-9"
              title="Bulk import Qoder device tokens"
              @click="showBulkImport = 'qoder'"
            >
              <span class="material-symbols-outlined text-sm"
                >playlist_add</span
              >
              Bulk Add
            </Button>
            <Button
              v-if="providerId === 'grok-cli'"
              variant="secondary"
              class="h-9"
              title="Bulk import Grok CLI OAuth refresh tokens"
              @click="showBulkImport = 'grok-cli'"
            >
              <span class="material-symbols-outlined text-sm"
                >playlist_add</span
              >
              Bulk Add
            </Button>
            <Button
              v-if="isCodebuddyIntlCli"
              variant="secondary"
              class="h-9"
              title="Bulk import CodeBuddy Intl CLI refresh tokens"
              @click="showBulkImport = 'codebuddy-intl-cli'"
            >
              <span class="material-symbols-outlined text-sm"
                >playlist_add</span
              >
              Bulk Add
            </Button>
            <Button
              v-if="providerId === 'grok-cli'"
              variant="secondary"
              class="h-9"
              title="Export all Grok CLI accounts to grok2api format"
              :disabled="exportingGrokCli || !allConnections.length"
              @click="handleExportGrokCli"
            >
              <span
                class="material-symbols-outlined text-sm"
                :class="{ 'animate-spin': exportingGrokCli }"
                >download</span
              >
              {{ exportingGrokCli ? "Exporting..." : "Export" }}
            </Button>
            <DropdownMenu
              v-if="providerId === 'autoclaw' && allConnections.length"
              :items="autoclawBulkActionItems"
              @select="handleAutoclawBulkAction"
            />
            <template v-if="hasDualAuthModes">
              <Button
                variant="secondary"
                class="h-9"
                @click="triggerOAuthConnection"
              >
                <span class="material-symbols-outlined text-sm">lock</span>
                {{ oauthConnectionLabel }}
              </Button>
              <Button class="h-9" @click="triggerApiKeyConnection">
                <span class="material-symbols-outlined text-sm">key</span>
                {{ apiKeyConnectionLabel }}
              </Button>
            </template>
            <Button v-else class="h-9" @click="triggerAddConnection">
              <span class="material-symbols-outlined text-sm">add</span> Add
            </Button>
          </div>
        </div>
      </div>

      <div
        v-if="!allConnections.length"
        class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-center gap-3">
          <div
            class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <span class="material-symbols-outlined text-[18px]">{{
              isOAuth ? "lock" : "key"
            }}</span>
          </div>
          <div class="min-w-0">
            <p class="text-sm text-muted-foreground">No connections yet</p>
            <p v-if="hasDualAuthModes" class="text-xs text-muted-foreground">
              Choose {{ oauthConnectionLabel }} or {{ apiKeyConnectionLabel }}.
            </p>
          </div>
        </div>
        <div class="flex gap-2">
          <template v-if="hasDualAuthModes">
            <Button
              v-if="
                [
                  'codex',
                  'qoder',
                  'grok-cli',
                  'codebuddy-intl-cli',
                ].includes(providerId)
              "
              variant="secondary"
              @click="showBulkImport = providerId as 'codex'"
            >
              <span class="material-symbols-outlined text-sm"
                >playlist_add</span
              >
              Bulk Add
            </Button>
            <Button variant="secondary" @click="triggerOAuthConnection">
              <span class="material-symbols-outlined text-sm">lock</span>
              {{ oauthConnectionLabel }}
            </Button>
            <Button @click="triggerApiKeyConnection">
              <span class="material-symbols-outlined text-sm">key</span>
              {{ apiKeyConnectionLabel }}
            </Button>
          </template>
          <template v-else>
            <Button
              v-if="
                [
                  'codex',
                  'qoder',
                  'grok-cli',
                  'codebuddy-intl-cli',
                ].includes(providerId)
              "
              variant="secondary"
              @click="showBulkImport = providerId as 'codex'"
            >
              <span class="material-symbols-outlined text-sm"
                >playlist_add</span
              >
              Bulk Add
            </Button>
            <Button @click="triggerAddConnection">
              <span class="material-symbols-outlined text-sm">add</span>
              Add Connection
            </Button>
          </template>
        </div>
      </div>

      <template v-else>
        <div
          v-if="oneByOneSummary"
          class="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <div class="flex flex-wrap items-center gap-3">
            <span>Total: {{ oneByOneSummary.total }}</span>
            <span>Completed: {{ oneByOneSummary.completed }}</span>
            <span>Passed: {{ oneByOneSummary.passed }}</span>
            <span>Failed: {{ oneByOneSummary.failed }}</span>
            <span
              v-if="oneByOneSummary.stopped"
              class="text-amber-600 dark:text-amber-400"
              >Stopped</span
            >
            <span v-if="oneByOneRunning && oneByOneCurrentConnectionId"
              >Running:
              {{
                allConnections.find((c) => c.id === oneByOneCurrentConnectionId)
                  ?.name || oneByOneCurrentConnectionId
              }}</span
            >
          </div>
        </div>
        <ProviderConnectionTable
          :connections="visibleConnections"
          :provider-id="providerId"
          :is-oauth="isOAuth"
          :proxy-pools="activePools"
          :selected-ids="selectedConnectionIds"
          :all-selected="allSelected"
          :first-id="firstConnectionId"
          :last-id="lastConnectionId"
          :quota-columns="quotaColumns"
          :quota-data="quotaData"
          :quota-loading="quotaLoading"
          :quota-errors="quotaErrors"
          :one-by-one-results="oneByOneResults"
          :auto-ping-key="autoPingKey"
          :auto-ping-config="autoPingConfig"
          :codex-credit-counts="codexCreditCounts"
          :codex-resetting-id="codexResettingId"
          :autoclaw-tasks="autoclawTasks"
          :autoclaw-claiming="autoclawClaiming"
          :autoclaw-loaded="autoclawLoaded"
          :codebuddy-probed="codebuddyProbed"
          @toggle-select="toggleSelectConnection"
          @toggle-select-all="toggleSelectAllConnections"
          @move-up="handleMoveUp"
          @move-down="handleMoveDown"
          @toggle-active="handleUpdateConnectionStatus"
          @update-proxy="handleUpdateProxy"
          @edit="
            (conn) => {
              editingConnection = conn;
              showEditModal = true;
            }
          "
          @delete="handleDelete"
          @auto-ping="
            (id, on) =>
              saveAutoPing({
                enabled: autoPingConfig.enabled === true,
                connections: {
                  ...(autoPingConfig.connections || {}),
                  [id]: on,
                },
              })
          "
          @refresh-quota="
            (id) => {
              const conn = allConnections.find((c) => c.id === id);
              if (conn) refreshProviderQuota(id, conn.provider);
            }
          "
          @codex-reset-limit="
            (conn) =>
              (codexResetConfirm = {
                connection: conn,
                resetCreditCount: codexResetCreditCount(conn.id),
              })
          "
          @codex-view-credits="handleViewCodexResetCredits"
          @tested="handleTested"
          @claim="claimAutoclaw"
          @inspiration="openInspirationCenter"
          @bind-invite="(id) => openInviteBind({ ids: [id] })"
          @probe-history="openCodebuddyProbeHistory"
          @clear-cooldown="handleClearCooldown"
          @account="(id) => (accountDrawerId = id)"
        />
        <div
          v-if="connectionsTotalPages > 1"
          class="mt-3 flex items-center justify-between gap-3"
        >
          <p class="text-xs text-muted-foreground">
            {{ connectionsTotal }} connection{{
              connectionsTotal === 1 ? "" : "s"
            }}
            · page {{ connectionsPage }} of {{ connectionsTotalPages }}
          </p>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="flex h-9 items-center rounded-md border border-input px-3 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="connectionsPage <= 1"
              @click="connectionsPage = Math.max(1, connectionsPage - 1)"
            >
              Previous
            </button>
            <button
              type="button"
              class="flex h-9 items-center rounded-md border border-input px-3 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="connectionsPage >= connectionsTotalPages"
              @click="
                connectionsPage = Math.min(
                  connectionsTotalPages,
                  connectionsPage + 1,
                )
              "
            >
              Next
            </button>
          </div>
        </div>
      </template>
    </Card>
    <NoAuthProxyCard
      v-if="isFreeNoAuth && meta.optionalApiKey"
      :provider-id="providerId"
      title="Public access"
      description="Free models need no account. Paid models use the accounts above. Public traffic is routed through a proxy pool."
    />

    <!-- Models -->
    <Card class="p-5 sm:p-6">
      <div
        class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <h2 class="text-lg font-semibold">Available Models</h2>
        <div class="flex flex-wrap items-center gap-2">
          <Select
            v-if="hasFreeModels"
            :model-value="modelPriceFilter"
            :options="modelPriceFilterOptions"
            class="w-auto min-w-28"
            aria-label="Model filter"
            @update:model-value="selectModelPriceFilter"
          />
          <Select
            v-if="providerThinkingLevels"
            :model-value="thinkingMode"
            :options="thinkingOptions"
            title="Appends (level) suffix to copied model names"
            class="w-auto min-w-28"
            aria-label="Thinking level"
            @update:model-value="selectThinkingMode"
          />
          <Button
            v-if="isCompatible"
            variant="secondary"
            :disabled="importingModels || !hasActiveConnection"
            :title="
              hasActiveConnection
                ? 'Import models from the /models endpoint'
                : 'Add an active connection to import models'
            "
            @click="handleImportModels"
          >
            <span
              class="material-symbols-outlined text-sm"
              :class="{ 'animate-spin': importingModels }"
              >{{ importingModels ? "progress_activity" : "download" }}</span
            >
            {{ importingModels ? "Importing..." : "Import from /models" }}
          </Button>
          <Button
            v-if="disabledModelIds.size > 0"
            variant="secondary"
            @click="handleEnableAll"
          >
            <span class="material-symbols-outlined text-sm">restart_alt</span>
            Active All
          </Button>
          <Button
            v-if="visibleDisplayModels.length"
            variant="secondary"
            @click="handleDisableAll(visibleDisplayModels.map((m) => m.id))"
          >
            <span class="material-symbols-outlined text-sm">block</span>
            Disable All
          </Button>
          <Button variant="secondary" @click="openAddCustomModel">
            <span class="material-symbols-outlined text-sm">add</span> Add
            Model
          </Button>
        </div>
      </div>
      <p v-if="modelsTestError" class="mb-3 break-words text-xs text-red-500">
        {{ modelsTestError }}
      </p>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <ProviderModelRow
          v-for="model in visibleCustomModelRows"
          :key="`custom-${model.fullModel}`"
          :model="{ id: model.id, name: model.name }"
          :full-model="`${providerDisplayAlias}/${model.id}`"
          :alias="model.alias"
          is-custom
          :test-status="modelTestResults[model.id] || null"
          :is-testing="testingModelIds.has(model.id)"
          :can-test="hasActiveConnection || isFreeNoAuth"
          :caps="capsFor(model.id)"
          :thinking-suffix="resolveSuffix(model.id)"
          @test="handleTestModel(model.id)"
          @edit="openEditModel(model.id)"
          @delete-alias="
            model.source === 'custom'
              ? handleDeleteCustomModel(model.id)
              : handleDeleteAlias(model.alias)
          "
        />
        <ProviderModelRow
          v-for="model in visibleDisplayModels"
          :key="model.id"
          :model="model"
          :full-model="`${providerDisplayAlias}/${model.id}`"
          :alias="aliasFor(model.id)"
          :test-status="modelTestResults[model.id] || null"
          :is-testing="testingModelIds.has(model.id)"
          :can-test="hasActiveConnection || isFreeNoAuth"
          :caps="capsFor(model.id)"
          :thinking-suffix="resolveSuffix(model.id)"
          @test="handleTestModel(model.id)"
          @edit="openEditModel(model.id)"
          @disable="handleDisableModel(model.id)"
        />
        <button
          v-if="
            providerId === 'qoder' &&
            allConnections.some((c) => c.isActive !== false)
          "
          class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-500/40 px-3 py-2 text-xs text-blue-600 transition-colors hover:border-blue-500 hover:bg-blue-500/5 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto dark:text-blue-400"
          :disabled="importingModels"
          @click="handleImportModels"
        >
          <span
            class="material-symbols-outlined text-sm"
            :class="{ 'animate-spin': importingModels }"
            >{{ importingModels ? "progress_activity" : "download" }}</span
          >
          {{ importingModels ? "Fetching..." : "Fetch Qoder Models" }}
        </button>

        <div v-if="suggestedNotAdded.length" class="col-span-full mt-2">
          <p class="mb-2 text-xs text-muted-foreground">
            Suggested free models (≥200k context):
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="m in suggestedNotAdded"
              :key="m.id"
              class="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              :title="`${m.name || m.id} · ${(Number(m.contextLength || 0) / 1000).toFixed(0)}k ctx`"
              @click="handleAddCustomModel(m.id)"
            >
              <span class="material-symbols-outlined text-[13px]">add</span>
              {{ m.id.split("/").pop() }}
            </button>
          </div>
        </div>

        <div v-if="disabledDisplayModels.length" class="col-span-full mt-2">
          <p class="mb-2 text-xs text-muted-foreground">
            Disabled models ({{ disabledDisplayModels.length }}):
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="m in disabledDisplayModels"
              :key="m.id"
              class="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              title="Restore model"
              @click="handleEnableModel(m.id)"
            >
              <span class="material-symbols-outlined text-[13px]">add</span>
              {{ m.id }}
            </button>
          </div>
        </div>
      </div>
      <QoderModelContextWindows v-if="providerId === 'qoder'" />
    </Card>

    <!-- Modals -->
    <ProviderOAuthModal
      :open="showOAuthModal"
      :provider="providerId"
      :provider-name="providerName"
      @success="refresh"
      @close="showOAuthModal = false"
    />
    <AddApiKeyModal
      :open="showAddApiKeyModal"
      :provider="providerId"
      :provider-name="providerName"
      :proxy-pools="activePools"
      :error="addConnectionError"
      :existing-names="
        allConnections.map((c) => c.name).filter(Boolean) as string[]
      "
      @close="
        addConnectionError = '';
        showAddApiKeyModal = false;
      "
      @save="handleSaveApiKey"
      @bulk-done="refresh"
    />
    <InspirationCenterModal
      :open="inspirationConnectionId !== null"
      :connection-label="inspirationConnectionLabel"
      :items="inspirationItems"
      :loading="inspirationLoading"
      :claiming="inspirationClaiming"
      :claiming-all="inspirationClaimingAll"
      :error="inspirationError"
      :language="inspirationLanguage"
      @close="closeInspirationCenter"
      @claim="claimInspiration"
      @claim-all="claimAllInspirations"
      @claim-all-languages="claimAllInspirationsAllLanguages"
      @update:language="
        (language) => {
          inspirationLanguage = language;
          void loadInspirationItems();
        }
      "
    />
    <AccountDrawer
      :open="accountDrawerId !== null"
      :connection-id="accountDrawerId"
      :connection-label="accountDrawerLabel"
      @close="accountDrawerId = null"
    />
    <ProviderConnectionEditModal
      :connection="showEditModal ? editingConnection : null"
      :group-options="groupOptions"
      :proxy-pools="activePools"
      @close="
        showEditModal = false;
        editingConnection = null;
      "
      @save="handleUpdateConnection"
    />
    <BulkProxyModal
      :open="showBulkProxyModal"
      :connections="allConnections"
      :selected-connections="selectedConnections"
      :proxy-pools="activePools"
      @close="showBulkProxyModal = false"
      @apply="applyProxyAssignments"
    />
    <BulkMaxInFlightModal
      :open="showBulkMaxInFlightModal"
      :count="selectedConnectionIds.length"
      :applying="bulkMaxInFlightRunning"
      @close="showBulkMaxInFlightModal = false"
      @apply="handleBulkMaxInFlight"
    />
    <BulkImportModal
      :open="Boolean(showBulkImport)"
      :provider="showBulkImport || 'codex'"
      @close="showBulkImport = null"
      @success="refresh"
    />
    <Modal
      :open="Boolean(probe407Job)"
      title="Probe 407 Results"
      @close="closeProbe407Modal"
    >
      <div v-if="probe407Job?.result" class="flex flex-col gap-3">
        <div class="flex flex-wrap gap-3 text-xs">
          <Badge variant="secondary"
            >Total: {{ probe407Job.result.total }}</Badge
          >
          <Badge variant="info"
            >Completed: {{ probe407Job.result.completed }}</Badge
          >
          <Badge variant="success"
            >Healthy: {{ probe407Job.result.healthy }}</Badge
          >
          <Badge variant="destructive"
            >Damaged: {{ probe407Job.result.damaged }}</Badge
          >
          <Badge variant="warning"
            >Errors: {{ probe407Job.result.errors }}</Badge
          >
        </div>
        <div class="max-h-[60vh] overflow-y-auto rounded-lg border">
          <table
            class="w-full border-separate border-spacing-0 text-left text-xs"
          >
            <thead>
              <tr class="text-[10px] text-muted-foreground">
                <th class="font-semibold border-b bg-muted/60 px-3 py-2.5">
                  Account
                </th>
                <th
                  class="font-semibold border-b border-border px-2 py-2 text-center"
                >
                  Status
                </th>
                <th class="font-semibold border-b bg-muted/60 px-3 py-2.5">
                  Reply
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in probe407Job.result.items"
                :key="item.connectionId"
              >
                <td class="border-b border-border/60 px-2.25 py-1.5">
                  {{ item.name || item.email || item.connectionId }}
                </td>
                <td
                  class="border-b border-border/60 px-2.25 py-1.5 text-center"
                >
                  <Badge
                    :variant="
                      item.status === 'healthy'
                        ? 'success'
                        : item.status === 'damaged'
                          ? 'destructive'
                          : item.status === 'error'
                            ? 'error'
                            : 'secondary'
                    "
                    >{{ item.status }}</Badge
                  >
                </td>
                <td
                  class="max-w-[12rem] truncate border-b border-border/60 px-2.25 py-1.5"
                  :title="item.reply || item.error || ''"
                >
                  {{ item.reply || item.error || "—" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p
          v-if="
            probe407Job.status !== 'completed' &&
            probe407Job.status !== 'failed'
          "
          class="text-xs text-muted-foreground"
        >
          Probing in progress…
        </p>
        <div class="flex justify-end gap-2">
          <Button
            v-if="damagedProbe407Items.length"
            variant="destructive"
            :disabled="!probe407Finished || deletingDamaged"
            :title="probe407Finished ? '' : 'Wait until the probe finishes'"
            @click="handleDeleteDamaged"
            >Delete damaged ({{ damagedProbe407Items.length }})</Button
          >
          <Button variant="ghost" @click="closeProbe407Modal">Close</Button>
        </div>
      </div>
    </Modal>
    <Modal
      :open="showPriorityMeterModal"
      title="Priority meter"
      size="sm"
      @close="showPriorityMeterModal = false"
    >
      <div class="flex flex-col gap-3">
        <p class="text-xs leading-relaxed text-muted-foreground">
          Drain this meter on each account before falling back to that account's
          other meters. Once every account exhausts the chosen meter, the rest
          (e.g. Bonus Packs) start serving requests.
        </p>
        <div class="flex flex-col gap-1.5" role="radiogroup">
          <label
            v-for="name in ['', ...codebuddyPriorityMeterOptions]"
            :key="name || 'off'"
            class="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
            :class="
              (codebuddyPriorityMeter ?? '') === name
                ? 'border-primary bg-accent'
                : 'border-border'
            "
          >
            <input
              type="radio"
              name="priority-meter"
              class="accent-primary"
              :checked="(codebuddyPriorityMeter ?? '') === name"
              :disabled="codebuddyPrioritySaving"
              @change="saveCodebuddyPriorityMeter(name)"
            />
            <span>{{ name || "Off" }}</span>
          </label>
        </div>
        <div class="flex flex-col gap-1.5 border-t border-border pt-3">
          <p class="text-xs font-semibold text-foreground">
            Exhausted excluded models
          </p>
          <p class="text-xs leading-relaxed text-muted-foreground">
            Every model on one account shares the same upstream quota. When a
            model exhausts, all models cooldown — except these. Excluded models
            keep their own separate cooldown.
          </p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="model in codebuddyExcludedModels"
              :key="model"
              class="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs"
            >
              {{ model }}
              <button
                type="button"
                class="text-muted-foreground transition-colors hover:text-destructive"
                :disabled="codebuddyExcludedSaving"
                :aria-label="`Remove ${model}`"
                @click="removeCodebuddyExcludedModel(model)"
              >
                <span class="material-symbols-outlined text-[14px]"
                  >close</span
                >
              </button>
            </span>
            <span
              v-if="!codebuddyExcludedModels.length"
              class="text-xs italic text-muted-foreground"
              >None — all models share one cooldown.</span
            >
          </div>
          <div class="flex items-center gap-2">
            <input
              v-model="codebuddyExcludedDraft"
              type="text"
              placeholder="deepseek-v4.1-flash"
              class="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs focus:border-primary focus:outline-none"
              :disabled="codebuddyExcludedSaving"
              @keydown.enter.prevent="addCodebuddyExcludedModel"
            />
            <Button
              type="button"
              variant="secondary"
              :disabled="codebuddyExcludedSaving || !codebuddyExcludedDraft.trim()"
              @click="addCodebuddyExcludedModel"
              >Add</Button
            >
          </div>
        </div>
        <div class="flex justify-end">
          <Button variant="ghost" @click="showPriorityMeterModal = false"
            >Close</Button
          >
        </div>
      </div>
    </Modal>
    <Modal
      :open="showInviteBindModal"
      :title="inviteBindModalTitle"
      @close="showInviteBindModal = false"
    >
      <form class="flex flex-col gap-4" @submit.prevent="confirmInviteBind">
        <div class="space-y-2">
          <Label for="invite-bind-code">Invite Code</Label>
          <Input
            id="invite-bind-code"
            v-model="inviteBindCode"
            placeholder="Referral invite code"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            Binds this referral code to
            {{ inviteBindIds.length === 1 ? "the selected account" : `${inviteBindIds.length} selected accounts` }}.
            CodeBuddy CLI accounts run web chat and the daily probe first. Failed chains resume from the failed step.
          </p>
        </div>
        <div v-if="isCodebuddyIntlCli" class="space-y-2">
          <Label for="invite-bind-proxy">Proxy Pool</Label>
          <Select
            id="invite-bind-proxy"
            v-model="inviteBindProxyPoolId"
            :options="inviteBindProxyOptions"
            placeholder="Keep current proxy"
          />
          <p class="text-xs text-muted-foreground">
            Applied to the selected accounts before the chain runs.
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            @click="showInviteBindModal = false"
            >Cancel</Button
          >
          <Button type="submit" :disabled="inviteBindRunning || !inviteBindCode.trim()">
            {{ inviteBindRunning ? (inviteBindContinuing ? "Continuing…" : "Binding…") : (inviteBindContinuing ? "Continue" : "Bind") }}
          </Button>
        </div>
      </form>
    </Modal>
    <Modal
      :open="showProbe407Confirm"
      title="Probe 407"
      @close="showProbe407Confirm = false"
    >
      <form class="flex flex-col gap-4" @submit.prevent="confirmProbe407">
        <div class="space-y-2">
          <Label for="probe407-model">Model</Label>
          <Input
            id="probe407-model"
            v-model="probe407ModelInput"
            list="probe407-model-suggestions"
            placeholder="grok-4.6"
            autocomplete="off"
          />
          <datalist id="probe407-model-suggestions">
            <option
              v-for="name in PROBE407_MODEL_SUGGESTIONS"
              :key="name"
              :value="name"
            />
          </datalist>
          <p class="text-xs text-muted-foreground">
            Leave empty to use the default model.
          </p>
        </div>
        <div class="space-y-2">
          <Label for="probe407-timeout">Timeout (seconds)</Label>
          <Input
            id="probe407-timeout"
            v-model="probe407TimeoutInput"
            type="number"
            min="1"
            max="120"
            step="1"
            :placeholder="String(PROBE407_DEFAULT_TIMEOUT_S)"
          />
          <p class="text-xs text-muted-foreground">
            An account with no reply in this time is marked damaged. Default
            {{ PROBE407_DEFAULT_TIMEOUT_S }}s, from 1 to 120.
          </p>
        </div>
        <div class="space-y-2">
          <Label for="probe407-concurrency">Concurrent accounts</Label>
          <Input
            id="probe407-concurrency"
            v-model="probe407ConcurrencyInput"
            type="number"
            min="1"
            max="50"
            step="1"
            :placeholder="String(PROBE407_DEFAULT_CONCURRENCY)"
          />
          <p class="text-xs text-muted-foreground">
            How many accounts are probed at the same time. Default
            {{ PROBE407_DEFAULT_CONCURRENCY }}, from 1 to 50.
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            @click="showProbe407Confirm = false"
            >Cancel</Button
          >
          <Button type="submit" :disabled="probe407Running">
            {{ probe407Running ? "Probing…" : "Start Probe" }}
          </Button>
        </div>
      </form>
    </Modal>
    <Modal
      :open="showEditNodeModal && Boolean(providerNode)"
      title="Edit custom provider"
      size="lg"
      @close="showEditNodeModal = false"
    >
      <form
        v-if="providerNode"
        class="space-y-4"
        @submit.prevent="handleUpdateNode({ ...nodeForm })"
      >
        <div class="space-y-2">
          <Label for="node-logo">Logo</Label>
          <ProviderLogoInput
            id="node-logo"
            v-model="nodeForm.logo"
            :label="nodeForm.name"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-2">
            <Label for="node-name">Name</Label
            ><Input id="node-name" v-model="nodeForm.name" required />
          </div>
          <div class="space-y-2">
            <Label for="node-prefix">Prefix</Label
            ><Input id="node-prefix" v-model="nodeForm.prefix" required />
          </div>
        </div>
        <div class="space-y-2">
          <Label for="node-url">Base URL</Label
          ><Input
            id="node-url"
            v-model="nodeForm.baseUrl"
            type="url"
            required
          />
        </div>
        <div v-if="!isAnthropicCompatible" class="space-y-2">
          <Label for="node-api-type">API type</Label
          ><Select
            id="node-api-type"
            v-model="nodeForm.apiType"
            :options="compatibleApiTypeOptions"
          />
        </div>
        <p v-if="nodeFormError" class="text-xs text-destructive" role="alert">
          {{ nodeFormError }}
        </p>
        <div class="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            @click="showEditNodeModal = false"
            >Cancel</Button
          ><Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
    <Modal
      :open="showAddCustomModel"
      :title="editingModelId ? 'Edit Model Capabilities' : 'Add Custom Model'"
      @close="
        showAddCustomModel = false;
        resetCustomModelForm();
      "
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium">Model ID</label>
          <div class="flex gap-2">
            <input
              v-model="customModelDraft"
              type="text"
              placeholder="e.g. claude-opus-4-5"
              :disabled="Boolean(editingModelId)"
              class="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              @keydown.enter="testCustomModel"
              @input="
                customModelTest = null;
                customModelError = '';
              "
            />
            <Button
              variant="secondary"
              :disabled="
                !customModelDraft.trim() || customModelTest === 'testing'
              "
              @click="testCustomModel"
            >
              <span
                class="material-symbols-outlined text-sm"
                :class="{ 'animate-spin': customModelTest === 'testing' }"
                >science</span
              >
              {{ customModelTest === "testing" ? "Testing..." : "Test" }}
            </Button>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            Sent to provider as:
            <code class="rounded bg-sidebar px-1 font-mono">{{
              stripAlias(customModelDraft) || "model-id"
            }}</code>
          </p>
        </div>
        <div
          v-if="customModelTest === 'ok'"
          class="flex items-center gap-2 text-sm text-green-600"
        >
          <span class="material-symbols-outlined text-base">check_circle</span>
          Model is reachable
        </div>
        <div
          v-if="customModelTest === 'error'"
          class="flex items-start gap-2 text-sm text-red-500"
        >
          <span class="material-symbols-outlined shrink-0 text-base"
            >cancel</span
          >
          <span>{{ customModelError || "Model not reachable" }}</span>
        </div>
        <div class="space-y-2">
          <label class="block text-sm font-medium"
            >Capabilities (optional)</label
          >
          <div class="grid grid-cols-2 gap-x-4 gap-y-2">
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                v-model="customModelCaps.vision"
                class="h-4 w-4 rounded border-border"
              />
              <span class="material-symbols-outlined text-sm text-blue-500"
                >visibility</span
              >
              <span class="text-xs text-muted-foreground">Vision</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                v-model="customModelCaps.reasoning"
                class="h-4 w-4 rounded border-border"
              />
              <span class="material-symbols-outlined text-sm text-amber-500"
                >neurology</span
              >
              <span class="text-xs text-muted-foreground">Reasoning</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                v-model="customModelCaps.search"
                class="h-4 w-4 rounded border-border"
              />
              <span class="material-symbols-outlined text-sm text-green-500"
                >travel_explore</span
              >
              <span class="text-xs text-muted-foreground">Web Search</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                v-model="customModelCaps.audioInput"
                class="h-4 w-4 rounded border-border"
              />
              <span class="material-symbols-outlined text-sm text-purple-500"
                >graphic_eq</span
              >
              <span class="text-xs text-muted-foreground">Audio Input</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                v-model="customModelCaps.imageOutput"
                class="h-4 w-4 rounded border-border"
              />
              <span class="material-symbols-outlined text-sm text-pink-500"
                >photo_camera</span
              >
              <span class="text-xs text-muted-foreground">Image Output</span>
            </label>
          </div>
          <p class="text-xs text-muted-foreground">
            Check the capabilities this model supports. These will be displayed
            as badges next to the model name.
          </p>
        </div>
        <div class="flex gap-2 pt-1">
          <Button
            variant="ghost"
            class="flex-1"
            size="sm"
            @click="
              showAddCustomModel = false;
              resetCustomModelForm();
            "
            >Cancel</Button
          >
          <Button
            class="flex-1"
            size="sm"
            :disabled="!customModelDraft.trim()"
            @click="saveCustomModel"
            >{{ editingModelId ? "Save" : "Add Model" }}</Button
          >
        </div>
      </div>
    </Modal>
    <ConfirmModal
      :open="showAgRiskModal"
      title="Risk Notice"
      :message="meta.deprecationNotice"
      confirm-text="I Understand, Continue"
      cancel-text="Cancel"
      @confirm="handleAgRiskConfirm"
      @close="showAgRiskModal = false"
    />
    <ConfirmModal
      :open="Boolean(confirmState)"
      :title="confirmState?.title || 'Confirm'"
      :message="confirmState?.message"
      :confirm-text="confirmState?.confirmText || 'Confirm'"
      @confirm="confirmState?.onConfirm()"
      @close="confirmState = null"
    />

    <!-- Codex reset limit confirm -->
    <ConfirmModal
      :open="Boolean(codexResetConfirm)"
      title="Reset Codex limit?"
      :message="`Use 1 Codex reset credit for ${codexResetConfirm?.connection.name || codexResetConfirm?.connection.email || 'this account'}. This cannot be undone. Remaining credits: ${codexResetConfirm?.resetCreditCount ?? 0}.`"
      confirm-text="Reset limit"
      :loading="Boolean(codexResettingId)"
      @confirm="
        codexResetConfirm &&
          handleCodexResetLimit(codexResetConfirm.connection.id);
        codexResetConfirm = null;
      "
      @close="!codexResettingId && (codexResetConfirm = null)"
    />

    <!-- Codex reset credits modal -->
    <div
      v-if="codexResetCredits"
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
                codexResetCredits.connection.name ||
                codexResetCredits.connection.email ||
                "Codex account"
              }}
            </p>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close reset credit expiry modal"
            @click="codexResetCredits = null"
          >
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div class="max-h-[70vh] overflow-auto p-4">
          <div
            v-if="codexResetCredits.loading"
            class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
          >
            <span class="material-symbols-outlined animate-spin text-[20px]"
              >progress_activity</span
            >
            Loading reset credits...
          </div>
          <div
            v-else-if="codexResetCredits.error"
            class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
          >
            {{ codexResetCredits.error }}
          </div>
          <div
            v-else-if="codexResetCredits.data?.credits?.length"
            class="space-y-3"
          >
            <div
              class="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <span
                >{{ codexResetCredits.data.credits.length }} reset credit{{
                  codexResetCredits.data.credits.length === 1 ? "" : "s"
                }}</span
              >
              <span
                >{{
                  codexResetCredits.data.availableCount ?? 0
                }}
                available</span
              >
            </div>
            <div class="overflow-x-auto rounded-xl border border-border">
              <table class="w-full min-w-[560px] text-left text-sm">
                <thead class="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th class="font-semibold px-3 py-2">Status</th>
                    <th class="font-semibold px-3 py-2">Granted At</th>
                    <th class="font-semibold px-3 py-2">Expires At</th>
                    <th class="font-semibold px-3 py-2">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(credit, index) in codexResetCredits.data.credits"
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

    <!-- CodeBuddy probe history modal -->
    <div
      v-if="codebuddyProbeHistory"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
    >
      <div
        class="w-full max-w-2xl overflow-hidden rounded-2xl border border-input bg-background shadow-2xl"
      >
        <div
          class="flex items-start justify-between gap-3 border-b border-border bg-muted/60 px-4 py-3"
        >
          <div class="min-w-0">
            <h3 class="text-base font-semibold">Probe History</h3>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {{
                codebuddyProbeHistory.connection.name ||
                codebuddyProbeHistory.connection.email ||
                "CodeBuddy account"
              }}
            </p>
          </div>
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close probe history modal"
            @click="codebuddyProbeHistory = null"
          >
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div class="max-h-[70vh] overflow-auto p-4">
          <div
            v-if="codebuddyProbeHistory.loading"
            class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
          >
            <span class="material-symbols-outlined animate-spin text-[20px]"
              >progress_activity</span
            >
            Loading probe history...
          </div>
          <div
            v-else-if="codebuddyProbeHistory.error"
            class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
          >
            {{ codebuddyProbeHistory.error }}
          </div>
          <div
            v-else-if="codebuddyProbeHistory.records.length"
            class="overflow-x-auto rounded-xl border border-border"
          >
            <table class="w-full min-w-[560px] text-left text-sm">
              <thead class="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th class="font-semibold px-3 py-2">Day</th>
                  <th class="font-semibold px-3 py-2">Status</th>
                  <th class="font-semibold px-3 py-2">Detail</th>
                  <th class="font-semibold px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                <template
                  v-for="record in codebuddyProbeHistory.records"
                  :key="record.day"
                >
                  <tr
                    class="border-t border-border/60 cursor-pointer transition-colors hover:bg-muted/40"
                    @click="
                      codebuddyProbeHistory!.expandedDay =
                        codebuddyProbeHistory!.expandedDay === record.day
                          ? null
                          : record.day
                    "
                  >
                    <td class="px-2.25 py-1.5 font-mono">
                      <span
                        class="mr-1 inline-block transition-transform"
                        :class="
                          codebuddyProbeHistory!.expandedDay === record.day
                            ? 'rotate-90'
                            : ''
                        "
                        >&#9654;</span
                      >{{ record.day }}
                    </td>
                    <td class="px-2.25 py-1.5">
                      <span
                        class="rounded-full px-2 py-0.5 text-xs font-medium"
                        :class="
                          record.status === 'completed'
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-red-500/10 text-red-600 dark:text-red-400'
                        "
                        >{{ record.status }}</span
                      >
                    </td>
                    <td
                      class="max-w-[280px] truncate px-2.25 py-1.5 text-muted-foreground"
                      :title="record.error || ''"
                    >
                      {{ record.error || "—" }}
                    </td>
                    <td class="px-2.25 py-1.5 text-muted-foreground">
                      {{
                        record.updatedAt
                          ? new Date(record.updatedAt).toLocaleString()
                          : "—"
                      }}
                    </td>
                  </tr>
                  <tr v-if="codebuddyProbeHistory!.expandedDay === record.day">
                    <td colspan="4" class="px-2.25 py-2.25">
                      <div
                        v-if="record.checkin"
                        class="mb-3 flex flex-wrap items-center gap-2 text-xs"
                      >
                        <span class="font-semibold">Check-in</span>
                        <span
                          class="rounded-full px-2 py-0.5 text-xs font-medium"
                          :class="
                            record.checkin.state === 'claimed'
                              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                              : record.checkin.state === 'already_claimed'
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                : 'bg-red-500/10 text-red-600 dark:text-red-400'
                          "
                          >{{ record.checkin.state }}</span
                        >
                        <span
                          v-if="record.checkin.credit !== null"
                          class="text-muted-foreground"
                          >+{{ record.checkin.credit }} credits</span
                        >
                        <span
                          v-if="record.checkin.streakDays !== null"
                          class="text-muted-foreground"
                          >streak {{ record.checkin.streakDays }}</span
                        >
                        <span
                          v-if="record.checkin.error"
                          class="text-red-500"
                          >{{ record.checkin.error }}</span
                        >
                      </div>
                      <div v-if="record.checkin?.detail" class="mb-3 space-y-3">
                        <div class="flex flex-wrap items-center gap-2 text-xs">
                          <span class="font-semibold">Check-in request</span>
                          <span class="font-mono"
                            >{{ record.checkin.detail.method }}
                            {{ record.checkin.detail.url }}</span
                          >
                          <span
                            class="rounded-full px-2 py-0.5 text-xs font-medium"
                            :class="
                              (record.checkin.detail.responseStatus ?? 0) < 400
                                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                : 'bg-red-500/10 text-red-600 dark:text-red-400'
                            "
                            >{{ record.checkin.detail.responseStatus ?? "—" }}
                            {{
                              record.checkin.detail.responseStatusText ?? ""
                            }}</span
                          >
                          <span
                            class="text-muted-foreground"
                            v-if="
                              record.checkin.detail.startedAt &&
                              record.checkin.detail.endedAt
                            "
                          >
                            {{
                              new Date(
                                record.checkin.detail.startedAt,
                              ).toLocaleTimeString()
                            }}
                            →
                            {{
                              new Date(
                                record.checkin.detail.endedAt,
                              ).toLocaleTimeString()
                            }}
                          </span>
                        </div>

                        <div>
                          <p
                            class="mb-1 text-xs font-semibold text-muted-foreground"
                          >
                            Request Headers
                          </p>
                          <pre
                            class="overflow-x-auto rounded-lg bg-muted p-2 text-xs"
                            >{{
                              JSON.stringify(
                                record.checkin.detail.requestHeaders ?? {},
                                null,
                                2,
                              )
                            }}</pre>
                        </div>

                        <div>
                          <p
                            class="mb-1 text-xs font-semibold text-muted-foreground"
                          >
                            Response Body
                          </p>
                          <pre
                            class="overflow-x-auto rounded-lg bg-muted p-2 text-xs"
                            >{{
                              record.checkin.detail.responseBody || "—"
                            }}</pre>
                        </div>
                      </div>
                      <div v-if="record.probe" class="space-y-3">
                        <div class="flex flex-wrap items-center gap-2 text-xs">
                          <span class="font-mono font-semibold"
                            >{{ record.probe.method }}
                            {{ record.probe.url }}</span
                          >
                          <span
                            class="rounded-full px-2 py-0.5 text-xs font-medium"
                            :class="
                              (record.probe.responseStatus ?? 0) < 400
                                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                : 'bg-red-500/10 text-red-600 dark:text-red-400'
                            "
                            >{{ record.probe.responseStatus }}
                            {{ record.probe.responseStatusText }}</span
                          >
                          <span
                            class="text-muted-foreground"
                            v-if="
                              record.probe.startedAt && record.probe.endedAt
                            "
                          >
                            {{
                              new Date(
                                record.probe.startedAt,
                              ).toLocaleTimeString()
                            }}
                            →
                            {{
                              new Date(
                                record.probe.endedAt,
                              ).toLocaleTimeString()
                            }}
                          </span>
                        </div>

                        <div>
                          <p
                            class="mb-1 text-xs font-semibold text-muted-foreground"
                          >
                            Request Headers
                          </p>
                          <pre
                            class="overflow-x-auto rounded-lg bg-muted p-2 text-xs"
                            >{{
                              JSON.stringify(
                                record.probe.requestHeaders ?? {},
                                null,
                                2,
                              )
                            }}</pre>
                        </div>

                        <div>
                          <p
                            class="mb-1 text-xs font-semibold text-muted-foreground"
                          >
                            Request Body
                          </p>
                          <pre
                            class="overflow-x-auto rounded-lg bg-muted p-2 text-xs"
                            >{{
                              JSON.stringify(
                                record.probe.requestBody ?? null,
                                null,
                                2,
                              )
                            }}</pre>
                        </div>

                        <div>
                          <p
                            class="mb-1 text-xs font-semibold text-muted-foreground"
                          >
                            Response Body
                          </p>
                          <pre
                            class="overflow-x-auto rounded-lg bg-muted p-2 text-xs"
                            >{{ record.probe.responseBody || "—" }}</pre>
                        </div>
                      </div>
                      <div v-else class="text-xs text-muted-foreground">
                        No probe detail stored for this run.
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div
            v-else
            class="rounded-xl border border-border bg-muted/40 px-3 py-8 text-center text-sm text-muted-foreground"
          >
            No probe runs recorded for this account yet.
          </div>
          <p class="mt-3 text-[11px] text-muted-foreground">
            One row per day. Only the last run each day is kept.
          </p>
        </div>
      </div>
    </div>

    <!-- Plan model map modal -->
    <Modal
      :open="showPlanModelMap"
      title="Plan model map"
      size="full"
      @close="showPlanModelMap = false"
    >
      <TabSwitcher
        v-model="planModelTab"
        class="mb-3"
        :options="[
          { value: 'access', label: 'Plan access' },
          { value: 'fallbacks', label: 'Fallbacks' },
        ]"
      />
      <CodexPlanModelMatrix
        v-if="planModelTab === 'access'"
        v-model="planDraft"
        :plans="codexPlanCounts.filter(([p]) => p !== 'unknown').map(([plan, count]) => ({ plan, count }))"
        :models="codexRegistryModelIds"
        :saving="codexPlanModelMapSaving"
      />

      <!-- Model fallbacks -->
      <div v-else>
        <p class="mb-1 text-xs font-semibold">Model fallbacks</p>
        <p class="mb-3 text-xs text-muted-foreground">
          When a model is unavailable on every account that may serve it, the
          next model in its list is tried. Plan restrictions above still apply
          to each fallback model.
        </p>

        <div
          v-for="model in codexModelFallbackKeys"
          :key="model"
          class="mb-3 space-y-2 rounded-md border border-border/60 p-3"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold">{{ model }}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive"
              :disabled="codexPlanModelMapSaving"
              :title="`Remove fallbacks for ${model}`"
              @click="removeCodexFallbackModel(model)"
            >
              <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <template
              v-for="(fallback, index) in codexModelFallbacks[model]"
              :key="fallback"
            >
              <span
                v-if="index > 0"
                class="material-symbols-outlined text-[13px] text-muted-foreground"
                >arrow_forward</span
              >
              <span
                class="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium"
              >
                {{ fallback }}
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  :disabled="codexPlanModelMapSaving || index === 0"
                  title="Move earlier"
                  @click="moveFallback(model, index, -1)"
                >
                  <span class="material-symbols-outlined text-[13px]"
                    >arrow_upward</span
                  >
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground disabled:opacity-40"
                  :disabled="
                    codexPlanModelMapSaving ||
                    index === (codexModelFallbacks[model] || []).length - 1
                  "
                  title="Move later"
                  @click="moveFallback(model, index, 1)"
                >
                  <span class="material-symbols-outlined text-[13px]"
                    >arrow_downward</span
                  >
                </button>
                <button
                  type="button"
                  class="text-muted-foreground hover:text-foreground"
                  :disabled="codexPlanModelMapSaving"
                  @click="removeFallbackFromModel(model, fallback)"
                >
                  <span class="material-symbols-outlined text-[13px]"
                    >close</span
                  >
                </button>
              </span>
            </template>
            <span
              v-if="(codexModelFallbacks[model] || []).length === 0"
              class="text-[11px] text-muted-foreground"
              >No fallbacks — failure on this model is returned to the
              client.</span
            >
          </div>
          <div class="flex items-center gap-1.5">
            <input
              :value="codexFallbackInputByModel[model] || ''"
              :list="`codex-fallback-suggestions-${model}`"
              placeholder="fallback model id"
              class="h-7 min-w-[140px] flex-1 rounded-md border border-border bg-transparent px-2 text-[11px]"
              @input="
                codexFallbackInputByModel = {
                  ...codexFallbackInputByModel,
                  [model]: ($event.target as HTMLInputElement).value,
                }
              "
              @keydown.enter.prevent="
                addFallbackToModel(
                  model,
                  codexFallbackInputByModel[model] || '',
                )
              "
            />
            <datalist :id="`codex-fallback-suggestions-${model}`">
              <option
                v-for="id in codexFallbackSuggestions(model)"
                :key="id"
                :value="id"
              />
            </datalist>
            <Button
              size="sm"
              variant="secondary"
              class="h-7 px-2 text-[11px]"
              :disabled="
                codexPlanModelMapSaving ||
                !(codexFallbackInputByModel[model] || '').trim()
              "
              @click="
                addFallbackToModel(
                  model,
                  codexFallbackInputByModel[model] || '',
                )
              "
            >
              Add
            </Button>
          </div>
        </div>

        <div
          v-if="codexModelFallbackKeys.length === 0"
          class="mb-3 text-xs text-muted-foreground"
        >
          No model fallbacks — a model failure is returned to the client.
        </div>

        <div class="flex items-center gap-1.5">
          <input
            v-model="codexNewFallbackModelInput"
            list="codex-fallback-model-suggestions"
            placeholder="fallback for model (e.g. gpt-5.6-sol)"
            class="h-7 min-w-[160px] flex-1 rounded-md border border-border bg-transparent px-2 text-[11px]"
            @keydown.enter.prevent="
              addCodexFallbackModel(codexNewFallbackModelInput)
            "
          />
          <datalist id="codex-fallback-model-suggestions">
            <option
              v-for="id in codexFallbackModelSuggestions"
              :key="id"
              :value="id"
            />
          </datalist>
          <Button
            size="sm"
            variant="secondary"
            class="h-7 px-2 text-[11px]"
            :disabled="
              codexPlanModelMapSaving || !codexNewFallbackModelInput.trim()
            "
            @click="addCodexFallbackModel(codexNewFallbackModelInput)"
          >
            Add model
          </Button>
        </div>
      </div>
      <template v-if="planModelTab === 'access'" #footer>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-muted-foreground">{{
            planDraftDirty ? "Unsaved changes" : "All changes saved"
          }}</span>
          <div class="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              :disabled="!planDraftDirty || codexPlanModelMapSaving"
              @click="resetPlanDraft"
              >Discard</Button
            >
            <Button
              size="sm"
              :disabled="!planDraftDirty || codexPlanModelMapSaving"
              @click="saveCodexPlanModelMap(planDraft)"
            >
              {{ codexPlanModelMapSaving ? "Saving…" : "Save" }}
            </Button>
          </div>
        </div>
      </template>
    </Modal>
  </div>
</template>
