// Port of v1 usage/components/ProviderLimits/utils.js — keep behavior in sync.

export const REFRESH_INTERVAL_MS = 60_000;
// Claude usage/quota endpoint rate-limits; poll it less often than other providers
export const CLAUDE_REFRESH_INTERVAL_MS = 180_000;
export const DEPLETED_QUOTA_THRESHOLD = 5;
export const AUTO_REFRESH_STORAGE_KEY = "quotaAutoRefresh";
export const CONNECTIONS_PAGE_SIZE = 100;
export const ACCOUNT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const ACCOUNT_PAGE_SIZE_MAX = 500;
export const ACCOUNT_FILTER_OPTIONS = [
  { value: "all", label: "All accounts" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Turned off" },
];
export const QUOTA_SORT_OPTIONS = [
  { value: "default", label: "Default quota order" },
  { value: "remaining-asc", label: "% quota: low to high" },
  { value: "remaining-desc", label: "% quota: high to low" },
];

export interface NormalizedQuotaRow {
  name: string;
  modelKey?: string;
  used: number;
  total: number;
  unit?: string;
  balance?: number;
  creditBalance?: number;
  remaining?: number;
  remainingPercentage?: number;
  resetAt: string | null;
  recurring?: boolean;
  message?: string;
}

export interface QuotaConnection {
  id: string;
  provider: string;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
  authType?: string;
  testStatus?: string | null;
  isActive?: boolean;
  priority?: number;
  providerSpecificData?: Record<string, unknown>;
  [key: string]: unknown;
}

export function getConnectionLabel(connection: QuotaConnection): string | null {
  return (
    connection.name?.trim() ||
    connection.email?.trim() ||
    connection.displayName?.trim() ||
    null
  );
}

export function getConnectionSecondaryLabel(
  connection: QuotaConnection,
): string | null {
  if (
    connection.name?.trim() &&
    connection.email?.trim() &&
    connection.name.trim() !== connection.email.trim()
  ) {
    return connection.email.trim();
  }
  if (
    connection.name?.trim() &&
    connection.displayName?.trim() &&
    connection.name.trim() !== connection.displayName.trim()
  ) {
    return connection.displayName.trim();
  }
  return null;
}

export function getConnectionQuotaRemaining(
  connection: QuotaConnection,
  quotaData: Record<string, QuotaEntry>,
): number {
  const quota = quotaData[connection.id]?.quotas?.[0];
  if (!quota) return Number.POSITIVE_INFINITY;
  if (typeof quota.remaining === "number") return quota.remaining;
  return Number.POSITIVE_INFINITY;
}

export function sortVisibleConnections(
  connections: QuotaConnection[],
  quotaData: Record<string, QuotaEntry>,
  expiringFirst: boolean,
  providerFilter: string,
  quotaSortMode: string,
): QuotaConnection[] {
  if (providerFilter === "codex" && quotaSortMode !== "default") {
    return [...connections].sort((a, b) => {
      const remainingA = getConnectionQuotaRemaining(a, quotaData);
      const remainingB = getConnectionQuotaRemaining(b, quotaData);
      const remainingDiff =
        quotaSortMode === "remaining-asc"
          ? remainingA - remainingB
          : remainingB - remainingA;
      if (remainingDiff !== 0) return remainingDiff;
      return (getConnectionLabel(a) || "").localeCompare(
        getConnectionLabel(b) || "",
      );
    });
  }

  if (!expiringFirst) return connections;

  const getEarliestResetTime = (connection: QuotaConnection) => {
    const resetTimes = (quotaData[connection.id]?.quotas || [])
      .map((quota) =>
        quota.resetAt
          ? new Date(quota.resetAt).getTime()
          : Number.POSITIVE_INFINITY,
      )
      .filter((time) => Number.isFinite(time));
    return resetTimes.length > 0
      ? Math.min(...resetTimes)
      : Number.POSITIVE_INFINITY;
  };

  return [...connections].sort((a, b) => {
    const expiryDiff = getEarliestResetTime(a) - getEarliestResetTime(b);
    if (expiryDiff !== 0) return expiryDiff;
    return (
      (a.provider || "").localeCompare(b.provider || "") ||
      (getConnectionLabel(a) || "").localeCompare(getConnectionLabel(b) || "")
    );
  });
}

export function groupConnectionsByProvider(
  connections: QuotaConnection[],
): Array<{ provider: string; connections: QuotaConnection[] }> {
  const groups: Array<{ provider: string; connections: QuotaConnection[] }> =
    [];
  const groupsByProvider = new Map<
    string,
    { provider: string; connections: QuotaConnection[] }
  >();
  for (const connection of connections) {
    const provider = connection.provider || "unknown";
    let group = groupsByProvider.get(provider);
    if (!group) {
      group = { provider, connections: [] };
      groupsByProvider.set(provider, group);
      groups.push(group);
    }
    group.connections.push(connection);
  }
  return groups;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Totals {
  eligibleConnections: number;
  providerFilteredConnections: number;
}

export function getConnectionsPageRange(pagination: Pagination) {
  if (!pagination.total) return { start: 0, end: 0 };
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  return { start, end };
}

export function getConnectionsEmptyMessage(
  totals: Totals,
  providerFilter: string,
  accountFilter: string,
) {
  if (!totals.eligibleConnections) {
    return {
      icon: "cloud_off",
      title: "No Providers Connected",
      description:
        "Connect to providers with OAuth to track your API quota limits and usage.",
    };
  }
  if (!totals.providerFilteredConnections) {
    return {
      icon: "filter_alt_off",
      title: "No Accounts Match Current Filters",
      description:
        providerFilter === "all"
          ? "Try changing the account status filter to see more quota trackers."
          : `No ${accountFilter === "inactive" ? "turned off" : accountFilter === "active" ? "active" : "matching"} accounts found for ${providerFilter}.`,
    };
  }
  return {
    icon: "filter_alt_off",
    title: "No Accounts On This Page",
    description:
      "Try moving to another page or refreshing the current filters.",
  };
}

export function getConnectionsPaginationSummary(pagination: Pagination) {
  const { start, end } = getConnectionsPageRange(pagination);
  return `Showing ${start}-${end} of ${pagination.total}`;
}

export function getQuotaVisibilityKey(quota: NormalizedQuotaRow) {
  if (!quota || typeof quota !== "object") return "";
  return String(quota.modelKey || quota.name || "").trim();
}

function getProviderHiddenQuotaSet(
  provider: string,
  quotaVisibility: Record<string, { hidden?: string[] }>,
) {
  const hidden = quotaVisibility?.[provider]?.hidden;
  return new Set(Array.isArray(hidden) ? hidden.map(String) : []);
}

export function filterQuotasByVisibility(
  provider: string,
  quotas: NormalizedQuotaRow[],
  quotaVisibility: Record<string, { hidden?: string[] }>,
) {
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getProviderHiddenQuotaSet(provider, quotaVisibility);
  if (hidden.size === 0) return quotas;
  return quotas.filter((quota) => !hidden.has(getQuotaVisibilityKey(quota)));
}

export function getHiddenQuotaRows(
  provider: string,
  quotas: NormalizedQuotaRow[],
  quotaVisibility: Record<string, { hidden?: string[] }>,
) {
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getProviderHiddenQuotaSet(provider, quotaVisibility);
  if (hidden.size === 0) return [];
  return quotas.filter((quota) => hidden.has(getQuotaVisibilityKey(quota)));
}

/** Format an ISO date as a zero-padded day, hour, and minute countdown. */
export function formatResetTime(value: string | Date | null): string {
  if (!value) return "-";
  try {
    const resetDate = typeof value === "string" ? new Date(value) : value;
    const diffMs = resetDate.getTime() - Date.now();
    if (diffMs <= 0) return "-";
    const totalMinutes = Math.ceil(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    return [days, hours, minutes]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  } catch {
    return "-";
  }
}

export function calculatePercentage(used: number, total: number): number {
  if (!total || total === 0) return 0;
  if (!used || used < 0) return 100;
  if (used >= total) return 0;
  return Math.round(((total - used) / total) * 100);
}

/** Format a raw points/credit balance as a full, grouped number. */
export function formatBalance(value: number): string {
  return Number(value || 0).toLocaleString();
}

export function getRemainingPercentage(quota: NormalizedQuotaRow): number {
  if (quota?.remaining !== undefined)
    return Math.max(0, Math.round(quota.remaining));
  if (quota?.remainingPercentage !== undefined)
    return Math.round(quota.remainingPercentage);
  return calculatePercentage(quota?.used, quota?.total);
}

export interface QuotaEntry {
  quotas: NormalizedQuotaRow[];
  plan?: string | null;
  message?: string | null;
  raw?: Record<string, unknown>;
}

type RawQuota = Record<string, any>;

/**
 * Parse provider-specific quota structures into a normalized array (v1 parseQuotaData).
 * `orderMap` mirrors v1's PROVIDER_MODELS ordering (model id → index per provider).
 */
export function parseQuotaData(
  provider: string,
  data: Record<string, unknown> | null | undefined,
  orderMap?: Map<string, number>,
): NormalizedQuotaRow[] {
  if (!data || typeof data !== "object") return [];
  const normalizedQuotas: NormalizedQuotaRow[] = [];
  const quotas = (data as RawQuota).quotas as
    Record<string, RawQuota> | undefined;

  try {
    switch (provider.toLowerCase()) {
      case "antigravity":
        if (quotas)
          for (const [modelKey, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name: quota.displayName || modelKey,
              modelKey,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          }
        break;
      case "codex":
        if (quotas)
          for (const [quotaType, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name: quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              remaining: quota.remaining,
              resetAt: quota.resetAt || null,
            });
          }
        break;
      case "qoder":
        // Skip an organization bucket when its total is 0; never forward Qoder's
        // absolute `remaining` credit count — the table reads it as a percentage.
        if (quotas)
          for (const [quotaType, quota] of Object.entries(quotas)) {
            if (
              quotaType === "organization" &&
              (!quota || (Number(quota.total) || 0) === 0)
            )
              continue;
            const displayName =
              typeof quota.displayName === "string" ? quota.displayName : "";
            const activityName = quota.activityId
              ? displayName.replace(/^Event:\s*/i, "").trim()
              : displayName;
            normalizedQuotas.push({
              name:
                activityName ||
                (quotaType === "user"
                  ? "Personal"
                  : quotaType === "organization"
                    ? "Organization"
                    : quotaType),
              modelKey: quota.activityId
                ? `event:${quota.activityId}`
                : quotaType,
              used: quota.used || 0,
              total: quota.total || 0,
              unit: quota.unit,
              resetAt: quota.resetAt || null,
              recurring: quota.recurring,
            });
          }
        break;
      case "claude":
        if ((data as RawQuota).message) {
          normalizedQuotas.push({
            name: "error",
            used: 0,
            total: 0,
            resetAt: null,
            message: (data as RawQuota).message,
          });
        } else if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          }
        break;
      case "codebuddy-intl-cli":
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            const used = Number(quota.used) || 0;
            const total = Number(quota.total) || 0;
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              creditBalance: Math.max(0, total - used),
              remainingPercentage:
                total > 0 ? (1 - used / total) * 100 : 100,
              unit: "credits",
              resetAt: quota.resetAt || null,
              recurring: quota.recurring !== false,
            });
          }
        break;
      case "grok-cli":
        // Never forward absolute `remaining` — use remainingPercentage.
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            const used = Number(quota.used) || 0;
            const total = Number(quota.total) || 0;
            const isTokenWindow =
              (/^Grok \d+\.\d+$/.test(name) || name === "Daily Allowance") &&
              total > 100;
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
              ...(isTokenWindow
                ? {
                    creditBalance: Math.max(0, total - used),
                    unit: "tokens",
                  }
                : {}),
            });
          }
        break;
      case "deepseek":
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
              remainingPercentage: quota.remainingPercentage,
            });
          }
        break;
      case "deepseek-harness":
        // DeepSeek Harness reports wallet balances in CNY/USD, not a quota window.
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name,
              used: 0,
              total: 0,
              unit: quota.unit || "CNY",
              balance: Number(quota.balance) || 0,
              resetAt: null,
            });
          }
        break;
      case "autoclaw":
        // Points wallets expose a raw balance (no fixed allotment); render the
        // formatted number, not a percentage bar.
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name: quota.name || name,
              modelKey: name,
              used: 0,
              total: 0,
              unit: quota.unit || "points",
              balance: Number(quota.balance) || 0,
              resetAt: quota.resetAt || null,
            });
          }
        break;
      case "river":
        // USD wallets always render as a balance row. Missing session values
        // arrive as null, so the row stays visible while the notice shows "-".
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name,
              modelKey: name,
              used: 0,
              total: 0,
              unit: quota.unit || "USD",
              balance: Number(quota.balance) || 0,
              resetAt: null,
            });
          }
        break;
      default:
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            normalizedQuotas.push({
              name,
              used: quota.used || 0,
              total: quota.total || 0,
              resetAt: quota.resetAt || null,
            });
          }
    }
  } catch {
    return [];
  }

  if (orderMap && orderMap.size > 0) {
    normalizedQuotas.sort(
      (a, b) =>
        (orderMap.get(a.modelKey || a.name) ?? 999) -
        (orderMap.get(b.modelKey || b.name) ?? 999),
    );
  }

  return normalizedQuotas;
}
