/**
 * Aggregated "Total Available" quota for a provider, computed purely from
 * quotaSnapshots.payload rows already persisted in SQLite. Read-only: never
 * triggers a remote fetch. The background QuotaSnapshotManager keeps the
 * payloads fresh (60s default, 180s for Claude), so the numbers served here
 * are at most one refresh interval stale.
 *
 * Keep extractQuotaRows in sync with frontend/src/lib/quota.ts parseQuotaData
 * (provider branches), trimmed to the numeric fields aggregation needs.
 */

import type { QuotaSnapshot } from "../../db/repositories";

export interface SummaryQuotaRow {
  name: string;
  modelKey?: string;
  used: number;
  total: number;
  remaining?: number;
  remainingPercentage?: number;
  balance?: number;
  creditBalance?: number;
  unit?: string;
}

export interface SummaryQuotaMeter {
  key: string;
  label: string;
  kind: "balance" | "percentage";
  balance: number;
  unit: string;
  remaining: number;
  creditBalance: number | null;
}

export interface ProviderQuotaSummary {
  kind: "balance" | "percentage" | null;
  totalBalance: number | null;
  unit: string | null;
  remainingPercent: number | null;
  totalCreditBalance: number;
  quotaMeters: SummaryQuotaMeter[];
  connectionsWithData: number;
  connectionsTotal: number;
  activeConnectionCount: number;
  inactiveConnectionCount: number;
  totalConnectionCount: number;
  lastFetchedAt: string | null;
}

type RawQuota = Record<string, any>;

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Extract the numeric quota rows for one provider payload. Mirror of the
 * provider branches in frontend parseQuotaData, including name/modelKey for
 * per-meter aggregation.
 */
export function extractQuotaRows(
  provider: string,
  payload: Record<string, unknown> | null | undefined,
): SummaryQuotaRow[] {
  if (!payload || typeof payload !== "object") return [];
  const quotas = (payload as RawQuota).quotas as Record<string, RawQuota> | undefined;
  const rows: SummaryQuotaRow[] = [];
  try {
    switch (provider.toLowerCase()) {
      case "antigravity":
        if (quotas)
          for (const [modelKey, quota] of Object.entries(quotas)) {
            rows.push({
              name: typeof quota.displayName === "string" ? quota.displayName : modelKey,
              modelKey,
              used: numberOr(quota.used, 0),
              total: numberOr(quota.total, 0),
              remainingPercentage:
                quota.remainingPercentage !== undefined
                  ? numberOr(quota.remainingPercentage, 0)
                  : undefined,
            });
          }
        break;
      case "deepseek":
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            rows.push({
              name,
              used: numberOr(quota.used, 0),
              total: numberOr(quota.total, 0),
              remainingPercentage:
                quota.remainingPercentage !== undefined
                  ? numberOr(quota.remainingPercentage, 0)
                  : undefined,
            });
          }
        break;
      case "codex":
        if (quotas)
          for (const [quotaType, quota] of Object.entries(quotas)) {
            rows.push({
              name: quotaType,
              used: numberOr(quota.used, 0),
              total: numberOr(quota.total, 0),
              remaining:
                quota.remaining !== undefined ? numberOr(quota.remaining, 0) : undefined,
            });
          }
        break;
      case "qoder":
        if (quotas)
          for (const [quotaType, quota] of Object.entries(quotas)) {
            if (quotaType === "organization" && numberOr(quota?.total, 0) === 0) continue;
            const displayName = typeof quota.displayName === "string" ? quota.displayName : "";
            const activityName = quota.activityId
              ? displayName.replace(/^Event:\s*/i, "").trim()
              : displayName;
            rows.push({
              name: activityName || (quotaType === "user" ? "Personal" : quotaType === "organization" ? "Organization" : quotaType),
              modelKey: quota.activityId ? `event:${quota.activityId}` : quotaType,
              used: numberOr(quota.used, 0),
              total: numberOr(quota.total, 0),
              unit: typeof quota.unit === "string" ? quota.unit : undefined,
            });
          }
        break;
      case "codebuddy-cn":
      case "codebuddy-intl-cli":
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            const used = numberOr(quota.used, 0);
            const total = numberOr(quota.total, 0);
            rows.push({
              name,
              used,
              total,
              creditBalance: Math.max(0, total - used),
              remainingPercentage: total > 0 ? (1 - used / total) * 100 : 100,
              unit: "credits",
            });
          }
        break;
      case "grok-cli":
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            const used = numberOr(quota.used, 0);
            const total = numberOr(quota.total, 0);
            const isTokenWindow =
              (/^Grok \d+\.\d+$/.test(name) || name === "Daily Allowance") && total > 100;
            rows.push({
              name,
              used,
              total,
              remainingPercentage:
                quota.remainingPercentage !== undefined
                  ? numberOr(quota.remainingPercentage, 0)
                  : undefined,
              ...(isTokenWindow
                ? { creditBalance: Math.max(0, total - used), unit: "tokens" }
                : {}),
            });
          }
        break;
      case "autoclaw":
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            rows.push({
              name: typeof quota.name === "string" ? quota.name : name,
              modelKey: name,
              used: 0,
              total: 0,
              balance: numberOr(quota.balance, 0),
              unit: typeof quota.unit === "string" ? quota.unit : "points",
            });
          }
        break;
      case "claude":
      default:
        if (provider.toLowerCase() === "claude" && (payload as RawQuota).message) break;
        if (quotas)
          for (const [name, quota] of Object.entries(quotas)) {
            rows.push({
              name,
              used: numberOr(quota.used, 0),
              total: numberOr(quota.total, 0),
              ...(quota.remainingPercentage !== undefined
                ? { remainingPercentage: numberOr(quota.remainingPercentage, 0) }
                : {}),
              ...(quota.remaining !== undefined
                ? { remaining: numberOr(quota.remaining, 0) }
                : {}),
              ...(quota.balance !== undefined
                ? {
                    balance: numberOr(quota.balance, 0),
                    unit: typeof quota.unit === "string" ? quota.unit : "points",
                  }
                : {}),
            });
          }
    }
  } catch {
    return [];
  }
  return rows;
}

/** Port of frontend getRemainingPercentage (frontend/src/lib/quota.ts). */
export function getRemainingPercentage(row: SummaryQuotaRow): number {
  if (row.remaining !== undefined) return Math.max(0, Math.round(row.remaining));
  if (row.remainingPercentage !== undefined) return Math.round(row.remainingPercentage);
  if (!row.total || row.total === 0) return 0;
  if (!row.used || row.used < 0) return 100;
  if (row.used >= row.total) return 0;
  return Math.round(((row.total - row.used) / row.total) * 100);
}

/** Port of frontend weightedRemaining (ProviderDetailView.vue). */
export function weightedRemaining(rows: SummaryQuotaRow[]): number {
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
  if (simpleCount > 0) return Math.min(100, Math.round(simpleSum / simpleCount));
  return 0;
}

/**
 * Aggregate the quota payloads of every active connection of one provider.
 * Only snapshots with status "ready" and at least one quota row contribute
 * to the numbers; the rest still count toward connectionsTotal.
 */
export function computeProviderQuotaSummary(
  provider: string,
  connectionsTotal: number,
  snapshots: Array<Pick<QuotaSnapshot, "payload" | "status" | "fetchedAt">>,
  activeConnectionCount: number,
  inactiveConnectionCount: number,
): ProviderQuotaSummary {
  const allRows: SummaryQuotaRow[] = [];
  let connectionsWithData = 0;
  let lastFetchedAt: string | null = null;

  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    if (snapshot.fetchedAt && (!lastFetchedAt || snapshot.fetchedAt > lastFetchedAt)) {
      lastFetchedAt = snapshot.fetchedAt;
    }
    if (snapshot.status !== "ready") continue;
    const rows = extractQuotaRows(provider, snapshot.payload);
    if (!rows.length) continue;
    connectionsWithData += 1;
    allRows.push(...rows);
  }

  const summary: ProviderQuotaSummary = {
    kind: null,
    totalBalance: null,
    unit: null,
    remainingPercent: null,
    totalCreditBalance: 0,
    quotaMeters: [],
    connectionsWithData,
    connectionsTotal,
    activeConnectionCount,
    inactiveConnectionCount,
    totalConnectionCount: activeConnectionCount + inactiveConnectionCount,
    lastFetchedAt,
  };
  if (!allRows.length) return summary;

  const meterMap = new Map<string, { rows: SummaryQuotaRow[]; label: string; kind: "balance" | "percentage"; unit: string }>();
  for (const row of allRows) {
    const key = row.modelKey || row.name;
    const existing = meterMap.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    meterMap.set(key, {
      rows: [row],
      label: row.name,
      kind: row.balance !== undefined ? "balance" : "percentage",
      unit: row.unit || "points",
    });
  }

  const quotaMeters: SummaryQuotaMeter[] = [];
  for (const [key, meter] of meterMap) {
    if (meter.kind === "balance") {
      quotaMeters.push({
        key,
        label: meter.label,
        kind: "balance",
        balance: meter.rows.reduce((sum, row) => sum + (row.balance || 0), 0),
        unit: meter.unit,
        remaining: 0,
        creditBalance: null,
      });
    } else {
      const creditRows = meter.rows.filter((row) => row.creditBalance !== undefined);
      quotaMeters.push({
        key,
        label: meter.label,
        kind: "percentage",
        balance: 0,
        unit: meter.unit,
        remaining: weightedRemaining(meter.rows),
        creditBalance: creditRows.length
          ? creditRows.reduce((sum, row) => sum + (row.creditBalance || 0), 0)
          : null,
      });
    }
  }
  summary.quotaMeters = quotaMeters;

  const balanceRows = allRows.filter((row) => row.balance !== undefined);
  if (balanceRows.length) {
    summary.kind = "balance";
    summary.totalBalance = balanceRows.reduce((sum, row) => sum + (row.balance || 0), 0);
    summary.unit = balanceRows.find((row) => row.unit)?.unit || "points";
  } else {
    summary.kind = "percentage";
    summary.remainingPercent = weightedRemaining(allRows);
  }
  summary.totalCreditBalance = allRows.reduce((sum, row) => sum + (row.creditBalance || 0), 0);
  return summary;
}
