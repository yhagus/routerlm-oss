import type { Database } from "bun:sqlite";
import { EventEmitter } from "node:events";
import { isPlainObject } from "../services/common/objects";
import { invalidateCustomNodes, registerCustomNodeLoader } from "../services/providers/customNodes.ts";
import { canonicalizeUsage } from "../services/common/usageTracking.ts";
import { aggregateUsage, deriveUsageFacts, isSuccessStatus, rollupUsageBefore, usageFacts, usageProviderCounts, usageRowsPage, usageTimeRange, usageTokenCounts, usageTotals, type UsageDimension, type UsageGroup, type UsageScope, type UsageTotals } from "./usageQueries";
import {
  calculateCostFromTokens,
  getDefaultPricing,
  resolveDefaultPricing,
  type ModelPricing,
  type PricingMap,
} from "../services/billing/pricing";

export interface Settings {
  requireLogin: boolean;
  requireApiKey: boolean;
  [key: string]: unknown;
}

export interface ProviderConnection {
  id: string;
  provider: string;
  authType: string;
  name: string | null;
  email: string | null;
  priority: number;
  isActive: boolean;
  apiType: string | null;
  baseUrl: string | null;
  credentials: Record<string, unknown>;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaSnapshot {
  connectionId: string;
  provider: string;
  payload: Record<string, unknown>;
  status: "pending" | "ready" | "error";
  fetchedAt: string | null;
  expiresAt: string | null;
  nextRefreshAt: string | null;
  lastError: string | null;
  failureCount: number;
  updatedAt: string;
}

export interface AutoclawTaskRecord {
  connectionId: string;
  taskId: string;
  day: string;
  status: "claimed" | "completed" | "error";
  rewardPoints: number;
  alreadyCompleted: boolean;
  error: string | null;
  payload: Record<string, unknown>;
  updatedAt: string;
}

export interface QuotaWindowRecord {
  connectionId: string;
  mode: string;
  remaining: number;
  total: number;
  usagePercent: number;
  breakdown: Array<{ productCode: number; usagePercent: number }>;
  windowSeconds: number;
  resetAt: string | null;
  syncedAt: string | null;
  source: string;
  updatedAt: string;
}

export interface QuotaRecoveryRecord {
  id: string;
  connectionId: string;
  mode: string;
  dueAt: string;
  attempts: number;
  claimToken: string;
  createdAt: string;
  updatedAt: string;
}

export interface RateLimitEventRecord {
  id: number;
  connectionId: string;
  mode: string | null;
  statusCode: number;
  retryAfter: number | null;
  resetAt: string | null;
  message: string | null;
  createdAt: string;
}

export type ConnectionTestJobStatus = "queued" | "running" | "completed" | "cancelled" | "failed";
export type ConnectionTestItemStatus = "queued" | "testing" | "success" | "failed" | "cancelled";

export interface ConnectionTestJobItemRecord {
  id: string;
  jobId: string;
  connectionId: string;
  position: number;
  status: ConnectionTestItemStatus;
  error: string | null;
  latencyMs: number | null;
  testedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestJobRecord {
  id: string;
  providerId: string;
  status: ConnectionTestJobStatus;
  delayMs: number;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  currentConnectionId: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  items: ConnectionTestJobItemRecord[];
}

export interface ApiKeyRecord {
  id: string;
  key: string;
  keyHash: string;
  keyPrefix: string | null;
  machineId: string | null;
  name: string | null;
  isActive: boolean;
  visibility: string;
  isDefault: boolean;
  comboAccessMode: string;
  comboAccessList: string[];
  modelAccessMode: string;
  modelAccessList: string[];
  limitMode: string;
  limitValue: number | null;
  maxConcurrency: number | null;
  status: string;
  connectionPins: Record<string, Record<string, string[]>>;
  usageRequests: number;
  usageTokens: number;
  features: Record<string, unknown>;
  createdAt: string;
}

export interface Repositories {
  settings: {
    get(): Settings;
    update(patch: Partial<Settings>): Settings;
    invalidateCache(): void;
  };
  pricing: {
    get(): PricingMap;
    getUser(): PricingMap;
    update(patch: PricingMap): PricingMap;
    reset(provider?: string, model?: string): PricingMap;
    resolve(provider: string | null | undefined, model: string | null | undefined): ModelPricing | null;
  };
    providers: {
    list(includeInactive?: boolean): ProviderConnection[];
    get(id: string): ProviderConnection | null;
    create(input: Record<string, unknown>): ProviderConnection;
    /**
     * Full update. Writes every column from `patch` over the cached row and
     * merges `patch.data` one level deep over the stored data: each top-level
     * data key replaces the stored key, and a `null` value is stored as null.
     * Use it for dashboard edits and re-logins that replace a Connection on
     * purpose. A caller that changes only data fields uses `patch`.
     */
    update(id: string, patch: Record<string, unknown>): ProviderConnection | null;
    /**
     * Partial update. Merges only the given data fields into the current cached
     * row and writes it synchronously. A `null` field clears that field.
     * `providerSpecificData` merges with its current value.
     */
    patch(id: string, changes: ConnectionPatch): ProviderConnection | null;
    noteUse(id: string, data: Record<string, unknown>): ProviderConnection | null;
    remove(id: string): boolean;
    select(provider: string, model?: string): ProviderConnection[];
    invalidateCache(): void;
  };
  quotaSnapshots: {
    get(connectionId: string): QuotaSnapshot | null;
    upsert(input: Omit<QuotaSnapshot, "updatedAt"> & { updatedAt?: string }): QuotaSnapshot;
    remove(connectionId: string): boolean;
  };
  autoclawTasks: {
    get(connectionId: string, taskId: string, day: string): AutoclawTaskRecord | null;
    upsert(input: Omit<AutoclawTaskRecord, "updatedAt" | "payload"> & { updatedAt?: string; payload?: Record<string, unknown> }): AutoclawTaskRecord;
    listByConnection(connectionId: string): AutoclawTaskRecord[];
    removeTask(connectionId: string, taskId: string): boolean;
  };
  nodes: {
    list(): Record<string, unknown>[];
    get(id: string): Record<string, unknown> | null;
    create(input: Record<string, unknown>): Record<string, unknown>;
    update(id: string, input: Record<string, unknown>): Record<string, unknown> | null;
    remove(id: string): boolean;
  };
  proxies: {
    list(): Record<string, unknown>[];
    get(id: string): Record<string, unknown> | null;
    create(input: Record<string, unknown>): Record<string, unknown>;
    update(id: string, input: Record<string, unknown>): Record<string, unknown> | null;
    remove(id: string): boolean;
  };
    keys: {
      list(): ApiKeyRecord[];
      getSecret(id: string): string | null;
      getByKey(key: string): ApiKeyRecord | null;
      getDefaultPublicKey(): { record: ApiKeyRecord; key: string } | null;
      create(input: Record<string, unknown>): { record: ApiKeyRecord; key: string };
      update(id: string, patch: Record<string, unknown>): ApiKeyRecord | null;
      remove(id: string): boolean;
      incrementUsage(id: string, tokens: number): void;
      invalidateCache(): void;
    };
  aliases: {
    list(): Record<string, string>;
    set(alias: string, targetModel: string): void;
    remove(alias: string): boolean;
  };
  combos: {
    list(): Record<string, unknown>[];
    get(idOrName: string): Record<string, unknown> | null;
    create(input: Record<string, unknown>): Record<string, unknown>;
    update(id: string, input: Record<string, unknown>): Record<string, unknown> | null;
    remove(id: string): boolean;
  };
  visionAdapters: {
    list(): Record<string, unknown>[];
    get(id: string): Record<string, unknown> | null;
    getGlobal(): Record<string, unknown> | null;
    create(input: Record<string, unknown>): Record<string, unknown>;
    update(id: string, input: Record<string, unknown>): Record<string, unknown> | null;
    remove(id: string): boolean;
    setGlobal(id: string): boolean;
    clearGlobal(): boolean;
  };
  quotaWindows: {
    list(connectionId: string): QuotaWindowRecord[];
    get(connectionId: string, mode: string): QuotaWindowRecord | null;
    upsert(input: Omit<QuotaWindowRecord, "updatedAt"> & { updatedAt?: string }): QuotaWindowRecord;
    listDue(now: string, limit: number): QuotaWindowRecord[];
    decrement(connectionId: string, mode: string, amount: number): QuotaWindowRecord | null;
    remove(connectionId: string, mode: string): boolean;
    removeForConnection(connectionId: string): number;
  };
  quotaRecovery: {
    list(): QuotaRecoveryRecord[];
    listDue(now: string, limit: number): QuotaRecoveryRecord[];
    get(id: string): QuotaRecoveryRecord | null;
    getByConnection(connectionId: string, mode: string): QuotaRecoveryRecord | null;
    create(input: Omit<QuotaRecoveryRecord, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): QuotaRecoveryRecord;
    incrementAttempts(id: string): QuotaRecoveryRecord | null;
    remove(id: string): boolean;
    removeForConnection(connectionId: string): number;
  };
  rateLimitEvents: {
    list(connectionId: string, limit?: number): RateLimitEventRecord[];
    create(input: Omit<RateLimitEventRecord, "id" | "createdAt"> & { createdAt?: string }): RateLimitEventRecord;
    removeOlderThan(timestamp: string): number;
    removeForConnection(connectionId: string): number;
  };
  connectionTestJobs: {
    create(input: { providerId: string; delayMs?: number; connectionIds: string[] }): ConnectionTestJobRecord;
    get(id: string): ConnectionTestJobRecord | null;
    latestForProvider(providerId: string): ConnectionTestJobRecord | null;
    activeForProvider(providerId: string): ConnectionTestJobRecord | null;
    claimNextQueued(): ConnectionTestJobRecord | null;
    markRunning(id: string, currentConnectionId: string | null): ConnectionTestJobRecord | null;
    markItemTesting(jobId: string, connectionId: string): ConnectionTestJobItemRecord | null;
    markItemResult(jobId: string, connectionId: string, result: { status: "success" | "failed"; error?: string | null; latencyMs?: number | null }): ConnectionTestJobRecord | null;
    requestCancel(id: string): ConnectionTestJobRecord | null;
    finish(id: string, status: "completed" | "cancelled" | "failed", error?: string | null): ConnectionTestJobRecord | null;
    recoverInterrupted(): number;
  };
  models: {
    list(kind?: string): Record<string, unknown>[];
    all(): Record<string, unknown>[];
    catalog(): Record<string, unknown>[];
    search(input: { query?: string; provider?: string; kind?: string; limit?: number }): Record<string, unknown>[];
    upsert(input: Record<string, unknown>): Record<string, unknown>;
    setDisabled(id: string, disabled: boolean): Record<string, unknown> | null;
    remove(id: string): boolean;
  };
  usage: {
    record(input: Record<string, unknown>): void;
    list(limit?: number): Record<string, unknown>[];
    // Newest first. Pass the returned nextCursor to read the next page. Throws InvalidUsageCursor for a malformed cursor.
    history(options?: { limit?: number; cursor?: string | null }): { items: Record<string, unknown>[]; nextCursor: string | null };
    summary(period?: string): Record<string, unknown>;
    dashboard(period?: string): Record<string, unknown>;
    chart(period?: string): Record<string, unknown>[];
    trend(by: UsageTrendBy, period?: string, top?: number, apiKey?: string): UsageTrend;
    overview(period?: string, modelLimit?: number): UsageOverview;
    providers(period?: string): Array<Record<string, unknown>>;
    // Provider ids with Usage rows, most requests first. Cheaper than providers("all").
    providerIds(): string[];
    apiKeys(apiKeys: string[], period?: string): Record<string, Record<string, unknown>>;
    statsForProvider(provider: string, period?: string, recentLimit?: number): Record<string, unknown>;
    statsForApiKey(apiKey: string, period?: string, recentLimit?: number): Record<string, unknown>;
    statsForAccount(connectionId: string, period?: string, recentLimit?: number): Record<string, unknown>;
    accounts(period?: string): Array<{ id: string; usage: Record<string, unknown> }>;
    models(period?: string): Array<{ id: string; usage: Record<string, unknown> }>;
    combos(period?: string): Array<{ id: string; usage: Record<string, unknown> }>;
    combosForApiKey(apiKey: string, period?: string): Record<string, Record<string, unknown>>;
     requestDetails(filter?: { page?: number; pageSize?: number; provider?: string; model?: string; connectionId?: string; status?: string; outcome?: string; search?: string; startDate?: string; endDate?: string }): { details: Record<string, unknown>[]; pagination: Record<string, unknown> };
     requestDetail(id: string): Record<string, unknown> | null;
    events: { on(event: string, listener: () => void): void; off(event: string, listener: () => void): void };
    flush(): void;
    // Moves up to `limit` raw rows older than `cutoff` (ISO) into daily
    // rollups per local day. Returns the moved row count; 0 when none is left.
    rollupBefore(cutoff: string, limit: number): number;
    pendingStart(connectionId: string, model: string, provider: string, apiKey?: string | null): void;
    pendingEnd(connectionId: string, model: string, provider: string, apiKey?: string | null): void;
    pendingSnapshot(): Map<string, Map<string, number>>;
    pendingKeySnapshot(): Map<string, number>;
    noteError(provider: string): void;
    errorProviderWindow(): string;
  };
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function bool(value: unknown): boolean {
  return value === true || value === 1;
}

function numberValue(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

// v1 custom-model shape: bare id + providerAlias, so legacy consumers
// (providerCustomModels, provider model listing) keep reading unchanged.
function customModelRow(row: Record<string, unknown>): Record<string, unknown> {
  const modelId = String(row.modelId || "");
  return {
    id: modelId,
    provider: String(row.providerAlias || ""),
    providerAlias: String(row.providerAlias || ""),
    model: modelId,
    name: String(row.name || modelId),
    kind: String(row.kind || "llm"),
    type: String(row.kind || "llm"),
    disabled: 0,
    source: "custom",
    capabilities: json<Record<string, unknown>>(row.capabilities, {}),
  };
}

// Unified catalog row: composite id, parsed capabilities, explicit source.
function catalogModelRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id || ""),
    provider: String(row.provider || ""),
    providerAlias: String(row.providerAlias || ""),
    modelId: String(row.modelId || ""),
    name: String(row.name || row.modelId || ""),
    kind: String(row.kind || "llm"),
    source: String(row.source || ""),
    upstreamModelId: row.upstreamModelId == null ? null : String(row.upstreamModelId),
    quotaFamily: row.quotaFamily == null ? null : String(row.quotaFamily),
    contextLength: row.contextLength == null ? null : Number(row.contextLength),
    capabilities: json<Record<string, unknown>>(row.capabilities, {}),
    sortOrder: numberValue(row.sortOrder ?? 999),
  };
}


export { usageTokenCounts };

// "publicModel" groups by the name a client sees: the combo name, else the bare model id.
export type UsageTrendBy = "provider" | "account" | "model" | "combo" | "apiKey" | "publicModel";

// Name shown on public pages. Hides the provider and any vendor path in the upstream model id.
export function publicModelName(comboName: unknown, model: unknown): string {
  const combo = typeof comboName === "string" ? comboName.trim() : "";
  if (combo) return combo;
  const raw = typeof model === "string" ? model.trim() : "";
  return raw.slice(raw.lastIndexOf("/") + 1) || "unknown";
}
export interface UsageTrend {
  period: string;
  labels: string[];
  series: Array<{ id: string; tokens: number[]; requests: number[] }>;
  // Readable names keyed by series id. Filled by the route, never by the repo.
  names?: Record<string, string>;
}
export interface UsageOverview {
  period: string;
  totals: { requests: number; tokens: number; cost: number; successRate: number | null; failed: number };
  // Same measures for the equally long window right before `period`. Null for "all", which has no earlier window.
  previous: { requests: number; tokens: number; cost: number; successRate: number | null } | null;
  labels: string[];
  buckets: Array<{ requests: number; failed: number; tokens: number; cost: number }>;
  peak: { label: string; requests: number } | null;
  costByProvider: Array<{ id: string; cost: number; requests: number }>;
  models: Array<{ id: string; requests: number; promptTokens: number; completionTokens: number; cost: number; failed: number }>;
}
const OTHER_SERIES_ID = "__other__";

function periodStart(period: string): string | null {
  if (period === "all") return null;
  if (period === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  if (period === "1h") return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (period === "24h") return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "60d" ? 60 : 0;
  if (!days) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  return start.toISOString();
}

const MINUTE_BUCKET_MS = 5 * 60 * 1000;
const MINUTE_BUCKETS = 12;

// "1h" shows twelve 5-minute buckets. The last bucket holds the current time.
function minuteBase(now = Date.now()): Date {
  return new Date(Math.floor(now / MINUTE_BUCKET_MS) * MINUTE_BUCKET_MS - (MINUTE_BUCKETS - 1) * MINUTE_BUCKET_MS);
}

function minuteLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function localDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type ConnectionPatch = {
  data?: Record<string, unknown>;
  isActive?: boolean;
  name?: string | null;
  email?: string | null;
};

// Applies changed fields over the current data. `null` clears a field and
// `undefined` leaves it unchanged. Nested provider-specific data merges the
// same way instead of replacing the whole object.
function mergeConnectionData(current: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else if (key === "providerSpecificData" && isPlainObject(value)) next[key] = mergeConnectionData(isPlainObject(current[key]) ? current[key] : {}, value);
    else next[key] = value;
  }
  return next;
}

function mapProvider(row: Record<string, unknown>): ProviderConnection {
  const data = json<Record<string, unknown>>(row.data, {});
  return {
    id: String(row.id),
    provider: String(row.provider),
    authType: String(row.authType),
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    priority: Number(row.priority ?? 0),
    isActive: bool(row.isActive),
    apiType: (data.apiType as string | null) ?? null,
    baseUrl: (data.baseUrl as string | null) ?? null,
    credentials: data,
    data,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapQuotaSnapshot(row: Record<string, unknown>): QuotaSnapshot {
  const status = row.status === "ready" || row.status === "error" ? row.status : "pending";
  return {
    connectionId: String(row.connectionId),
    provider: String(row.provider),
    payload: json<Record<string, unknown>>(row.payload, {}),
    status,
    fetchedAt: row.fetchedAt == null ? null : String(row.fetchedAt),
    expiresAt: row.expiresAt == null ? null : String(row.expiresAt),
    nextRefreshAt: row.nextRefreshAt == null ? null : String(row.nextRefreshAt),
    lastError: row.lastError == null ? null : String(row.lastError),
    failureCount: Number(row.failureCount) || 0,
    updatedAt: String(row.updatedAt),
  };
}

function mapAutoclawTask(row: Record<string, unknown>): AutoclawTaskRecord {
  const status = row.status === "claimed" || row.status === "completed" || row.status === "error" ? row.status : "error";
  return {
    connectionId: String(row.connectionId),
    taskId: String(row.taskId),
    day: String(row.day),
    status,
    rewardPoints: Number(row.rewardPoints) || 0,
    alreadyCompleted: row.alreadyCompleted === true || row.alreadyCompleted === 1,
    error: row.error == null ? null : String(row.error),
    payload: json<Record<string, unknown>>(row.payload, {}),
    updatedAt: String(row.updatedAt),
  };
}

function mapQuotaWindow(row: Record<string, unknown>): QuotaWindowRecord {
  return {
    connectionId: String(row.connectionId),
    mode: String(row.mode),
    remaining: Number(row.remaining) || 0,
    total: Number(row.total) || 0,
    usagePercent: Number(row.usagePercent) || 0,
    breakdown: json<Array<{ productCode: number; usagePercent: number }>>(row.breakdown, []),
    windowSeconds: Number(row.windowSeconds) || 0,
    resetAt: row.resetAt == null ? null : String(row.resetAt),
    syncedAt: row.syncedAt == null ? null : String(row.syncedAt),
    source: String(row.source || "default"),
    updatedAt: String(row.updatedAt),
  };
}

function mapQuotaRecovery(row: Record<string, unknown>): QuotaRecoveryRecord {
  return {
    id: String(row.id),
    connectionId: String(row.connectionId),
    mode: String(row.mode),
    dueAt: String(row.dueAt),
    attempts: Number(row.attempts) || 0,
    claimToken: String(row.claimToken),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapRateLimitEvent(row: Record<string, unknown>): RateLimitEventRecord {
  return {
    id: Number(row.id),
    connectionId: String(row.connectionId),
    mode: row.mode == null ? null : String(row.mode),
    statusCode: Number(row.statusCode) || 0,
    retryAfter: row.retryAfter == null ? null : Number(row.retryAfter),
    resetAt: row.resetAt == null ? null : String(row.resetAt),
    message: row.message == null ? null : String(row.message),
    createdAt: String(row.createdAt),
  };
}

function mapConnectionTestJobItem(row: Record<string, unknown>): ConnectionTestJobItemRecord {
  const status = row.status === "testing" || row.status === "success" || row.status === "failed" || row.status === "cancelled"
    ? row.status
    : "queued";
  return {
    id: String(row.id),
    jobId: String(row.jobId),
    connectionId: String(row.connectionId),
    position: Number(row.position) || 0,
    status,
    error: row.error == null ? null : String(row.error),
    latencyMs: row.latencyMs == null ? null : Number(row.latencyMs),
    testedAt: row.testedAt == null ? null : String(row.testedAt),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapConnectionTestJob(row: Record<string, unknown>, items: ConnectionTestJobItemRecord[] = []): ConnectionTestJobRecord {
  const status = row.status === "running" || row.status === "completed" || row.status === "cancelled" || row.status === "failed"
    ? row.status
    : "queued";
  return {
    id: String(row.id),
    providerId: String(row.providerId),
    status,
    delayMs: Number(row.delayMs) || 0,
    total: Number(row.total) || 0,
    completed: Number(row.completed) || 0,
    passed: Number(row.passed) || 0,
    failed: Number(row.failed) || 0,
    currentConnectionId: row.currentConnectionId == null ? null : String(row.currentConnectionId),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.createdAt),
    startedAt: row.startedAt == null ? null : String(row.startedAt),
    finishedAt: row.finishedAt == null ? null : String(row.finishedAt),
    updatedAt: String(row.updatedAt),
    items,
  };
}

function mapNode(row: Record<string, unknown>): Record<string, unknown> {
  const data = json<Record<string, unknown>>(row.data, {});
  return {
    ...data,
    id: String(row.id),
    type: String(row.type),
    name: String(row.name),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    key: String(row.key || ""),
    keyHash: "",
    keyPrefix: String(row.key || "").split(/[a-z0-9]{16}-/i)[0] || String(row.key || "").slice(0, 12),
    machineId: (row.machineId as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    isActive: bool(row.isActive),
    visibility: String(row.visibility ?? "private"),
    isDefault: bool(row.isDefault),
    comboAccessMode: String(row.comboAccessMode ?? "blacklist"),
    comboAccessList: json(row.comboAccessList, []),
    modelAccessMode: String(row.modelAccessMode ?? "whitelist"),
    modelAccessList: json(row.modelAccessList, []),
    limitMode: String(row.limitMode ?? "none"),
    limitValue: row.limitValue == null ? null : Number(row.limitValue),
    maxConcurrency: row.maxConcurrency == null ? null : Number(row.maxConcurrency),
    status: String(row.status ?? "submitted"),
    connectionPins: json(row.connectionPins, {}),
    usageRequests: Number(row.usageRequests ?? 0),
    usageTokens: Number(row.usageTokens ?? 0),
    features: json(row.features, {}),
    createdAt: String(row.createdAt),
  };
}

export function createRepositories(_db: unknown, rawSqlite: Database): Repositories {
  const sqlite: any = rawSqlite;
  registerCustomNodeLoader(() => (sqlite.query("SELECT * FROM providerNodes").all() as Record<string, unknown>[]).map(mapNode) as Array<{ id: unknown; type: unknown; apiType?: unknown }>);
  const readSettings = (): Settings => {
    const row = sqlite.query("SELECT data FROM settings WHERE id = 1").get() as { data: string } | null;
    return {
      requireLogin: true,
      requireApiKey: false,
      rtkEnabled: true,
      headroomEnabled: false,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      headroomCodeAware: false,
      headroomKompress: true,
      cavemanEnabled: false,
      cavemanLevel: "full",
      ponytailEnabled: false,
      ponytailLevel: "full",
      pxpipeEnabled: false,
      pxpipeAutoInstall: true,
      pxpipeMinChars: 25000,
      pxpipeTimeoutMs: 15000,
      enableObservability: true,
      observabilityMaxRecords: 1000,
      observabilityBatchSize: 20,
      observabilityFlushIntervalMs: 5000,
      observabilityMaxJsonSize: 5,
      // Raw Usage rows older than this many days move into daily rollups. 0 keeps every raw row.
      usageRetentionDays: 0,
      outboundProxyEnabled: false,
      outboundProxyUrl: "",
      outboundNoProxy: "",
      stickyRoundRobinLimit: 3,
      quotaPageSize: 100,
      providerStrategies: {} as Record<string, any>,
      quotaVisibility: {} as Record<string, any>,
      comboStrategy: "fallback",
      comboStickyRoundRobinLimit: 1,
      comboStrategies: {} as Record<string, any>,
      freeTrackerPublic: {} as Record<string, any>,
      autoclawAutoClaim: { intervalMinutes: 60, connections: {} },

      // codebuddy-intl-cli only: name of the quota meter (e.g. "Monthly") to
      // drain first before allowing an account's other meters (Bonus Pack N)
      // to serve requests. Null = feature disabled.
      // exhaustedExcludedModels: model ids that keep an independent cooldown
      // when a sibling model exhausts the shared account quota.
      codebuddyIntlCli: {
        priorityMeter: null as string | null,
        exhaustedExcludedModels: [] as string[],
      },
      tunnelEnabled: false,
      tunnelUrl: "",
      tunnelProvider: "cloudflare",
      tailscaleEnabled: false,
      tailscaleUrl: "",
      mitmRouterBaseUrl: "http://localhost:20128",
      dnsToolEnabled: {} as Record<string, any>,
      ...json(row?.data, {}),
    };
  };

  const readUserPricing = (): PricingMap => {
    const rows = sqlite.query("SELECT key AS provider, value AS data FROM kv WHERE scope = 'pricing'").all() as Array<{ provider: string; data: string }>;
    return Object.fromEntries(rows.map((row) => [row.provider, json<Record<string, ModelPricing>>(row.data, {})]));
  };

  // Live stats plumbing mirrors v1's statsEmitter: "update" after a recorded
  // usage row, "pending" when the in-flight request map changes.
  const usageEvents = new EventEmitter();
  const pendingByAccount = new Map<string, Map<string, number>>();
  const pendingByApiKey = new Map<string, number>();
  // v1 parity: leak-protection timer. If pendingEnd never fires (process
  // crash mid-stream, swallowed rejection), the entry auto-clears after
  // PENDING_TIMEOUT_MS so active traffic never freezes on a phantom request.
  const PENDING_TIMEOUT_MS = 60_000;
  const pendingTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; apiKey: string | null }>();
  let lastErrorProvider = { provider: "", ts: 0 };

  const USAGE_FLUSH_MS = 1000;
  const USAGE_FLUSH_BATCH = 50;
  type UsageWrite = {
    timestamp: string;
    provider: string | null;
    model: string | null;
    connectionId: string | null;
    apiKey: string | null;
    endpoint: string | null;
    clientIp: string | null;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    status: string;
    tokens: string;
    meta: string;
    cachedTokens: number;
    comboName: string;
    failed: number;
    successTps: number | null;
    successLatencyMs: number | null;
  };
  const usageQueue: UsageWrite[] = [];
  const keyUsageDeltas = new Map<string, { requests: number; tokens: number }>();
  // Deferred Connection data writes. Flush serializes the cached row at flush
  // time, so a deferred write never carries a copy older than the cache.
  const providerPersistQueue = new Map<string, { updatedAt: string }>();
  let usageTimer: ReturnType<typeof setTimeout> | null = null;
  let usageFlushing = false;
  let writesStopped = false;
  let settingsCache: Settings | null = null;
  let providerRows: ProviderConnection[] | null = null;
  const keysBySecret = new Map<string, ApiKeyRecord | null>();
  const keysById = new Map<string, ApiKeyRecord>();

  function cloneProvider(connection: ProviderConnection): ProviderConnection {
    const data = { ...connection.data };
    return { ...connection, data, credentials: data };
  }

  function loadProviders(): ProviderConnection[] {
    if (!providerRows) {
      providerRows = (sqlite.query("SELECT * FROM providerConnections ORDER BY priority ASC, createdAt ASC").all() as Record<string, unknown>[]).map(mapProvider);
    }
    return providerRows;
  }

  function rememberProvider(connection: ProviderConnection): void {
    const rows = loadProviders();
    const index = rows.findIndex((row) => row.id === connection.id);
    if (index >= 0) rows[index] = connection;
    else rows.push(connection);
    rows.sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt));
  }

  function forgetProvider(connectionId: string): void {
    if (!providerRows) return;
    providerRows = providerRows.filter((row) => row.id !== connectionId);
  }

  function cachedSettings(): Settings {
    if (!settingsCache) settingsCache = readSettings();
    return settingsCache;
  }

  function cacheKey(record: ApiKeyRecord): void {
    keysById.set(record.id, record);
    if (record.key) keysBySecret.set(record.key, record);
  }

  function dropKey(record: { id?: string; key?: string | null } | null): void {
    if (!record) return;
    if (record.id) keysById.delete(record.id);
    if (record.key) keysBySecret.delete(record.key);
    if (record.id) {
      for (const [secret, cached] of keysBySecret) {
        if (cached?.id === record.id) keysBySecret.delete(secret);
      }
    }
  }

  function withPendingKeyUsage(record: ApiKeyRecord): ApiKeyRecord {
    const delta = keyUsageDeltas.get(record.id);
    if (!delta) return record;
    return { ...record, usageRequests: record.usageRequests + delta.requests, usageTokens: record.usageTokens + delta.tokens };
  }

  function scheduleUsageFlush(): void {
    if (writesStopped || usageTimer || usageFlushing) return;
    usageTimer = setTimeout(() => {
      usageTimer = null;
      flushUsageWrites();
    }, USAGE_FLUSH_MS);
    usageTimer.unref?.();
  }

  function enqueueUsage(row: UsageWrite): void {
    usageQueue.push(row);
    if (usageQueue.length >= USAGE_FLUSH_BATCH) flushUsageWrites();
    else scheduleUsageFlush();
  }

  function bumpKeyUsage(keyId: string, tokens: number): void {
    const amount = Number(tokens) || 0;
    const cached = keysById.get(keyId);
    if (cached) {
      cached.usageRequests += 1;
      cached.usageTokens += amount;
    }
    const delta = keyUsageDeltas.get(keyId) || { requests: 0, tokens: 0 };
    delta.requests += 1;
    delta.tokens += amount;
    keyUsageDeltas.set(keyId, delta);
    if (usageQueue.length + keyUsageDeltas.size >= USAGE_FLUSH_BATCH) flushUsageWrites();
    else scheduleUsageFlush();
  }

  function persistProviderData(connectionId: string, updatedAt: string): void {
    providerPersistQueue.set(connectionId, { updatedAt });
    if (providerPersistQueue.size >= USAGE_FLUSH_BATCH) flushUsageWrites();
    else scheduleUsageFlush();
  }

  function flushUsageWrites(): void {
    if (usageTimer) {
      clearTimeout(usageTimer);
      usageTimer = null;
    }
    if (usageFlushing) return;
    if (usageQueue.length === 0 && keyUsageDeltas.size === 0 && providerPersistQueue.size === 0) return;
    usageFlushing = true;
    const rows = usageQueue.splice(0, usageQueue.length);
    const keys = [...keyUsageDeltas.entries()];
    keyUsageDeltas.clear();
    const providers = [...providerPersistQueue.entries()];
    providerPersistQueue.clear();
    try {
      const insert = sqlite.query(`INSERT INTO usageHistory (timestamp, provider, model, connectionId, apiKey, endpoint, clientIp, promptTokens, completionTokens, cost, status, tokens, meta, cachedTokens, comboName, failed, successTps, successLatencyMs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const bump = sqlite.query("UPDATE apiKeys SET usageRequests = usageRequests + ?, usageTokens = usageTokens + ? WHERE id = ?");
      const persist = sqlite.query("UPDATE providerConnections SET data = ?, updatedAt = ? WHERE id = ?");
      sqlite.transaction(() => {
        for (const row of rows) insert.run(row.timestamp, row.provider, row.model, row.connectionId, row.apiKey, row.endpoint, row.clientIp, row.promptTokens, row.completionTokens, row.cost, row.status, row.tokens, row.meta, row.cachedTokens, row.comboName, row.failed, row.successTps, row.successLatencyMs);
        for (const [keyId, delta] of keys) bump.run(delta.requests, delta.tokens, keyId);
        for (const [connectionId, payload] of providers) {
          const cached = providerRows?.find((row) => row.id === connectionId);
          if (cached) persist.run(JSON.stringify(cached.data), payload.updatedAt, connectionId);
        }
      })();
      if (rows.length) usageEvents.emit("update");
    } catch {
      usageQueue.unshift(...rows);
      for (const [keyId, delta] of keys) {
        const current = keyUsageDeltas.get(keyId) || { requests: 0, tokens: 0 };
        current.requests += delta.requests;
        current.tokens += delta.tokens;
        keyUsageDeltas.set(keyId, current);
      }
      for (const [connectionId, payload] of providers) {
        if (!providerPersistQueue.has(connectionId)) providerPersistQueue.set(connectionId, payload);
      }
    } finally {
      usageFlushing = false;
      if (!writesStopped && (usageQueue.length || keyUsageDeltas.size || providerPersistQueue.size)) scheduleUsageFlush();
    }
  }

  function stopUsageWrites(): void {
    writesStopped = true;
    flushUsageWrites();
  }

  const releasePendingKey = (apiKey: string) => {
    const count = (pendingByApiKey.get(apiKey) || 1) - 1;
    if (count > 0) pendingByApiKey.set(apiKey, count);
    else pendingByApiKey.delete(apiKey);
    usageEvents.emit("pending");
  };

  const readPricing = (): PricingMap => {
    const merged = getDefaultPricing();
    for (const [provider, models] of Object.entries(readUserPricing())) {
      merged[provider] ||= {};
      for (const [model, value] of Object.entries(models as Record<string, any>)) merged[provider][model] = { ...merged[provider][model], ...value };
    }
    return merged;
  };

  const resolvePricing = (provider: string | null | undefined, model: string | null | undefined): ModelPricing | null => {
    if (provider && model) {
      const user = readUserPricing()[provider]?.[model];
      if (user) return user;
    }
    return resolveDefaultPricing(provider, model);
  };

  // SQL reads must see queued rows and rows from writers outside usage.record.
  const usageReady = (): void => {
    flushUsageWrites();
    deriveUsageFacts(sqlite);
  };

  const periodScope = (period: string, scope: UsageScope = {}): UsageScope => ({ ...scope, since: periodStart(period) });

  const laterTimestamp = (current: string | null, candidate: string | null): string | null =>
    !current || (candidate && new Date(candidate) > new Date(current)) ? candidate : current;

  type GroupedStatsColumn = "connection_id" | "api_key_id" | "provider";
  const STATS_DIMENSION: Record<GroupedStatsColumn, UsageDimension> = { connection_id: "connectionId", api_key_id: "apiKey", provider: "provider" };

  function groupedStats(scope: UsageScope, groups: Array<[string, GroupedStatsColumn]> = [], recentLimit = 30): Record<string, unknown> {
    usageReady();
    const totals = usageTotals(sqlite, scope);
    const stats: Record<string, any> = {
      totalRequests: totals.requests,
      totalPromptTokens: totals.promptTokens,
      totalCompletionTokens: totals.completionTokens,
      totalCachedTokens: totals.cachedTokens,
      totalCost: totals.cost,
      lastUsed: totals.lastUsed,
      byModel: [] as any[],
      byIp: [] as any[],
      recentRequests: [] as any[],
    };

    const modelMap = new Map<string, any>();
    for (const group of aggregateUsage(sqlite, scope, { by: ["provider", "model"] })) {
      const provider = group.keys.provider || "";
      const model = group.keys.model || "unknown";
      const key = provider ? `${model} (${provider})` : model;
      const item = modelMap.get(key) || { rawModel: group.keys.model ?? null, provider, requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: group.lastUsed };
      item.requests += group.requests;
      item.promptTokens += group.promptTokens;
      item.completionTokens += group.completionTokens;
      item.cachedTokens += group.cachedTokens;
      item.cost += group.cost;
      item.lastUsed = laterTimestamp(item.lastUsed, group.lastUsed);
      modelMap.set(key, item);
    }

    for (const [output, column] of groups) {
      const map = new Map<string, any>();
      for (const group of aggregateUsage(sqlite, scope, { by: [STATS_DIMENSION[column]] })) {
        const key = group.keys[STATS_DIMENSION[column]] || "unknown";
        const item = map.get(key) || { id: key, [column]: key, requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: group.lastUsed };
        item.requests += group.requests;
        item.promptTokens += group.promptTokens;
        item.completionTokens += group.completionTokens;
        item.cachedTokens += group.cachedTokens;
        item.cost += group.cost;
        item.lastUsed = laterTimestamp(item.lastUsed, group.lastUsed);
        map.set(key, item);
      }
      stats[output] = [...map.values()].sort((a, b) => b.requests - a.requests);
    }

    const ips: any[] = [];
    for (const group of aggregateUsage(sqlite, scope, { by: ["clientIp"] })) {
      if (!group.keys.clientIp) continue;
      ips.push({ ip: group.keys.clientIp, requests: group.requests, promptTokens: group.promptTokens, completionTokens: group.completionTokens, lastUsed: group.lastUsed });
    }

    const recentCount = Math.max(0, Math.min(100, Number(recentLimit) || 30));
    const recentRows = recentCount ? usageRowsPage(sqlite, scope, recentCount).rows : [];
    for (const row of recentRows) {
      const counts = usageTokenCounts(row);
      const meta = metaOf(row);
      const tps = numberValue(meta.tokensPerSecond);
      const ip = typeof row.client_ip === "string" && row.client_ip.trim() ? row.client_ip.trim() : null;
      stats.recentRequests.push({ timestamp: String(row.timestamp), model: row.model, provider: row.provider ? String(row.provider) : "", comboName: comboNameOf(row) || null, tokensPerSecond: tps > 0 ? tps : null, latencyMs: numberValue(meta.totalMs) || null, success: isSuccessStatus(row.status), promptTokens: counts.promptTokens, completionTokens: counts.completionTokens, cachedTokens: counts.cachedTokens, status: row.status || "ok", clientIp: ip, connectionId: row.connection_id || null, apiKeyId: row.api_key_id || null });
    }

    stats.byModel = [...modelMap.values()].sort((a, b) => b.requests - a.requests);
    stats.byIp = ips.sort((a, b) => b.requests - a.requests);
    stats.totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens;
    stats.uniqueIps = stats.byIp.length;
    const topByRequests = stats.byModel[0] || null;
    const topByTokens = [...stats.byModel].sort((a, b) => b.promptTokens + b.completionTokens - a.promptTokens - a.completionTokens)[0] || null;
    stats.highlights = {
      mostRequestedModel: topByRequests ? { model: topByRequests.rawModel, provider: topByRequests.provider, requests: topByRequests.requests, totalTokens: topByRequests.promptTokens + topByRequests.completionTokens } : null,
      mostTokensModel: topByTokens ? { model: topByTokens.rawModel, provider: topByTokens.provider, requests: topByTokens.requests, totalTokens: topByTokens.promptTokens + topByTokens.completionTokens } : null,
    };
    return stats;
  }

  type UsageKeys = UsageGroup["keys"];

  // Totals per entity. SQL groups by raw columns; `keyFor` merges them under
  // the entity key. Groups arrive newest first, so the object keeps the order
  // a newest-first row scan would create.
  function usageTotalsGrouped(period: string, by: UsageDimension[], keyFor: (keys: UsageKeys) => string, scope: UsageScope = {}): Record<string, Record<string, unknown>> {
    usageReady();
    const result: Record<string, { requests: number; promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number; cost: number; lastUsed: string | null; failed: number; successCount: number; tpsSum: number; tpsCount: number; latencyMsSum: number; latencyCount: number }> = {};
    for (const group of aggregateUsage(sqlite, periodScope(period, scope), { by })) {
      const key = keyFor(group.keys) || "unknown";
      const item = result[key] || { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, cost: 0, lastUsed: null, failed: 0, successCount: 0, tpsSum: 0, tpsCount: 0, latencyMsSum: 0, latencyCount: 0 };
      item.requests += group.requests;
      item.promptTokens += group.promptTokens;
      item.completionTokens += group.completionTokens;
      item.cachedTokens += group.cachedTokens;
      item.totalTokens += group.promptTokens + group.completionTokens;
      item.cost += group.cost;
      item.failed += group.failed;
      item.successCount += group.requests - group.failed;
      item.tpsSum += group.tpsSum;
      item.tpsCount += group.tpsCount;
      item.latencyMsSum += group.latencyMsSum;
      item.latencyCount += group.latencyCount;
      item.lastUsed = laterTimestamp(item.lastUsed, group.lastUsed);
      result[key] = item;
    }
    return result;
  }

  const providerKey = (keys: UsageKeys) => keys.provider || "unknown";
  const modelKey = (keys: UsageKeys) => {
    const model = keys.model || "unknown";
    return keys.provider ? `${keys.provider}/${model}` : model;
  };

  // Local-day slots from the first to the last day in `keys`.
  function dayRanges(keys: string[]): Array<[string, string]> {
    return keys.map((key) => {
      const start = new Date(`${key}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return [start.toISOString(), end.toISOString()];
    });
  }

  // Every local-day key from the oldest to the newest row in scope.
  function daysInScope(scope: UsageScope): string[] {
    const { oldest, newest } = usageTimeRange(sqlite, scope);
    if (!oldest || !newest) return [];
    const first = new Date(oldest);
    const last = localDateKey(newest);
    if (Number.isNaN(first.getTime()) || Number.isNaN(new Date(newest).getTime())) return [];
    const keys: string[] = [];
    const day = new Date(first);
    day.setHours(0, 0, 0, 0);
    for (let key = localDateKey(day.toISOString()); key <= last && keys.length < 100_000; key = localDateKey(day.toISOString())) {
      keys.push(key);
      day.setDate(day.getDate() + 1);
    }
    return keys;
  }

  // Slots shared by trend and overview. "all" has one slot per local day that
  // has rows; `compact` drops the empty candidate days after the query.
  function usageCalendar(normalized: string, scope: UsageScope): { labels: string[]; ranges: Array<[string, string]>; compact(groups: UsageGroup[]): { labels: string[]; slotOf: (bucket: number) => number } } {
    const iso = (ms: number) => new Date(ms).toISOString();
    const identity = (labels: string[]) => ({ labels, slotOf: (bucket: number) => bucket });
    if (normalized === "1h") {
      const base = minuteBase().getTime();
      const starts = Array.from({ length: MINUTE_BUCKETS }, (_, index) => base + index * MINUTE_BUCKET_MS);
      const labels = starts.map((start) => minuteLabel(new Date(start)));
      return { labels, ranges: starts.map((start) => [iso(start), iso(start + MINUTE_BUCKET_MS)]), compact: () => identity(labels) };
    }
    if (normalized === "today" || normalized === "24h") {
      const base = new Date();
      base.setMinutes(0, 0, 0);
      if (normalized === "today") base.setHours(0, 0, 0, 0);
      else base.setHours(base.getHours() - 23);
      const starts = Array.from({ length: 24 }, (_, index) => base.getTime() + index * 60 * 60 * 1000);
      const labels = starts.map((start) => `${String(new Date(start).getHours()).padStart(2, "0")}:00`);
      return { labels, ranges: starts.map((start) => [iso(start), iso(start + 60 * 60 * 1000)]), compact: () => identity(labels) };
    }
    const dayLabel = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (normalized === "all") {
      const keys = daysInScope(scope);
      return {
        labels: keys.map(dayLabel),
        ranges: dayRanges(keys),
        compact(groups) {
          const used = [...new Set(groups.map((group) => group.bucket as number))].sort((left, right) => left - right);
          const slots = new Map(used.map((bucket, index) => [bucket, index]));
          return { labels: used.map((bucket) => dayLabel(keys[bucket])), slotOf: (bucket: number) => slots.get(bucket) ?? -1 };
        },
      };
    }
    const days = normalized === "7d" ? 7 : normalized === "30d" ? 30 : 60;
    const keys: string[] = [];
    for (let index = days - 1; index >= 0; index--) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - index);
      keys.push(localDateKey(date.toISOString()));
    }
    const labels = keys.map(dayLabel);
    return { labels, ranges: dayRanges(keys), compact: () => identity(labels) };
  }

  function comboNameOf(row: Record<string, unknown>): string {
    const raw = row.meta;
    let meta: Record<string, unknown> = {};
    if (raw && typeof raw === "string") { try { meta = JSON.parse(raw) as Record<string, unknown>; } catch { /* ignore malformed meta */ } }
    else if (raw && typeof raw === "object") meta = raw as Record<string, unknown>;
    return meta.comboName ? String(meta.comboName).trim() : "";
  }

  function metaOf(row: Record<string, unknown>): Record<string, unknown> {
    const raw = row.meta;
    if (raw && typeof raw === "string") { try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* ignore */ } }
    else if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    return {};
  }

  return {
    settings: {
      get() {
        return { ...cachedSettings() };
      },
      update(patch) {
        const value = { ...cachedSettings(), ...patch };
        sqlite.query("UPDATE settings SET data = ? WHERE id = 1").run(JSON.stringify(value));
        settingsCache = value;
        return { ...value };
      },
      invalidateCache() {
        settingsCache = null;
      },
    },
    pricing: {
      get: readPricing,
      getUser: readUserPricing,
      update(patch) {
        const timestamp = now();
        sqlite.transaction(() => {
          for (const [provider, models] of Object.entries(patch as Record<string, any>)) {
            const current = sqlite.query("SELECT value AS data FROM kv WHERE scope = 'pricing' AND key = ?").get(provider) as { data: string } | null;
            const merged = { ...json<Record<string, ModelPricing>>(current?.data, {}) };
            for (const [model, pricing] of Object.entries(models as Record<string, any>)) merged[model] = pricing;
            sqlite.query("INSERT INTO kv (scope, key, value) VALUES ('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value")
              .run(provider, JSON.stringify(merged));
          }
        })();
        return readUserPricing();
      },
      reset(provider, model) {
        if (!provider) {
          sqlite.query("DELETE FROM kv WHERE scope = 'pricing'").run();
          return readPricing();
        }
        if (!model) {
          sqlite.query("DELETE FROM kv WHERE scope = 'pricing' AND key = ?").run(provider);
          return readPricing();
        }
        const row = sqlite.query("SELECT value AS data FROM kv WHERE scope = 'pricing' AND key = ?").get(provider) as { data: string } | null;
        const models = json<Record<string, ModelPricing>>(row?.data, {});
        delete models[model];
        if (Object.keys(models).length) sqlite.query("UPDATE kv SET value = ? WHERE scope = 'pricing' AND key = ?").run(JSON.stringify(models), provider);
        else sqlite.query("DELETE FROM kv WHERE scope = 'pricing' AND key = ?").run(provider);
        return readPricing();
      },
      resolve: resolvePricing,
    },
    providers: {
      list(includeInactive = false) {
        const rows = loadProviders();
        return (includeInactive ? rows : rows.filter((row) => row.isActive)).map(cloneProvider);
      },
      get(connectionId) {
        const row = loadProviders().find((connection) => connection.id === connectionId);
        return row ? cloneProvider(row) : null;
      },
      create(input) {
        const timestamp = now();
        const connection = {
          id: String(input.id || id()),
          provider: String(input.provider || "compatible"),
          authType: String(input.authType || "api_key"),
          name: input.name == null ? null : String(input.name),
          email: input.email == null ? null : String(input.email),
          priority: Number(input.priority ?? 0),
          isActive: input.isActive === false ? 0 : 1,
          apiType: input.apiType == null ? null : String(input.apiType),
          baseUrl: input.baseUrl == null ? null : String(input.baseUrl),
          credentials: JSON.stringify(input.credentials || {}),
          data: JSON.stringify(input.data || {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const data = { ...input.data as object || {}, ...input.credentials as object || {} } as Record<string, unknown>;
        if (connection.apiType != null) data.apiType = connection.apiType;
        if (connection.baseUrl != null) data.baseUrl = connection.baseUrl;
        sqlite.query(`INSERT INTO providerConnections
          (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          connection.id, connection.provider, connection.authType, connection.name, connection.email,
          connection.priority, connection.isActive, JSON.stringify(data), connection.createdAt, connection.updatedAt,
        );
        const created = mapProvider({
          id: connection.id, provider: connection.provider, authType: connection.authType, name: connection.name,
          email: connection.email, priority: connection.priority, isActive: connection.isActive, data: JSON.stringify(data),
          createdAt: connection.createdAt, updatedAt: connection.updatedAt,
        });
        rememberProvider(created);
        return cloneProvider(created);
      },
      update(connectionId, patch) {
        const current = loadProviders().find((connection) => connection.id === connectionId);
        if (!current) return null;
        const next = { ...current, ...patch, updatedAt: now() } as Record<string, unknown>;
        const patchData = (patch as { data?: unknown }).data;
        const mergedBase = patchData != null && typeof patchData === "object" && !Array.isArray(patchData)
          ? { ...(current.data as object || {}), ...(patchData as object) }
          : (next.data as object || {});
        const credentialsPatch = (patch as { credentials?: object }).credentials;
        const persistedData = { ...mergedBase, ...(credentialsPatch ? (patch as Record<string, unknown>).credentials as object : {}) } as Record<string, unknown>;
        if (next.apiType != null) persistedData.apiType = next.apiType;
        if (next.baseUrl != null) persistedData.baseUrl = next.baseUrl;
        sqlite.query(`UPDATE providerConnections SET provider = ?, authType = ?, name = ?, email = ?, priority = ?,
          isActive = ?, data = ?, updatedAt = ? WHERE id = ?`).run(
          next.provider, next.authType, next.name ?? null, next.email ?? null, Number(next.priority ?? 0),
          next.isActive === false ? 0 : 1, JSON.stringify(persistedData), next.updatedAt, connectionId,
        );
        providerPersistQueue.delete(connectionId);
        const updated = mapProvider({
          id: connectionId, provider: next.provider, authType: next.authType, name: next.name, email: next.email,
          priority: next.priority, isActive: next.isActive === false ? 0 : 1, data: JSON.stringify(persistedData),
          createdAt: current.createdAt, updatedAt: next.updatedAt,
        });
        rememberProvider(updated);
        return cloneProvider(updated);
      },
      patch(connectionId, changes) {
        // No await between read and write: the merge always starts from the
        // newest cached row, so concurrent writers keep their fields.
        const current = loadProviders().find((connection) => connection.id === connectionId);
        if (!current) return null;
        const updatedAt = now();
        const data = changes.data ? mergeConnectionData(current.data, changes.data) : { ...current.data };
        const isActive = changes.isActive ?? current.isActive;
        const name = changes.name === undefined ? current.name : changes.name;
        const email = changes.email === undefined ? current.email : changes.email;
        sqlite.query("UPDATE providerConnections SET isActive = ?, name = ?, email = ?, data = ?, updatedAt = ? WHERE id = ?")
          .run(isActive ? 1 : 0, name ?? null, email ?? null, JSON.stringify(data), updatedAt, connectionId);
        providerPersistQueue.delete(connectionId);
        const next: ProviderConnection = {
          ...current,
          isActive,
          name,
          email,
          apiType: (data.apiType as string | null) ?? null,
          baseUrl: (data.baseUrl as string | null) ?? null,
          data,
          credentials: data,
          updatedAt,
        };
        rememberProvider(next);
        return cloneProvider(next);
      },
      noteUse(connectionId, data) {
        const current = loadProviders().find((connection) => connection.id === connectionId);
        if (!current) return null;
        const updatedAt = now();
        const persistedData = { ...current.data, ...data };
        const next = { ...current, data: persistedData, credentials: persistedData, updatedAt };
        rememberProvider(next);
        persistProviderData(connectionId, updatedAt);
        return cloneProvider(next);
      },
      remove(connectionId) {
        const removed = sqlite.query("DELETE FROM providerConnections WHERE id = ?").run(connectionId).changes > 0;
        if (removed) {
          providerPersistQueue.delete(connectionId);
          forgetProvider(connectionId);
        }
        return removed;
      },
      select(provider, _model) {
        return loadProviders()
          .filter((connection) => connection.provider === provider && connection.isActive)
          .filter((connection) => {
            const until = connection.data.rateLimitedUntil;
            return !(typeof until === "string" && new Date(until).getTime() > Date.now());
          })
          .map(cloneProvider);
      },
      invalidateCache() {
        providerRows = null;
      },
    },
    quotaSnapshots: {
      get(connectionId) {
        const row = sqlite.query("SELECT * FROM quotaSnapshots WHERE connectionId = ?").get(connectionId) as Record<string, unknown> | null;
        return row ? mapQuotaSnapshot(row) : null;
      },
      upsert(input) {
        const updatedAt = input.updatedAt || now();
        sqlite.query(`INSERT INTO quotaSnapshots
          (connectionId, provider, payload, status, fetchedAt, expiresAt, nextRefreshAt, lastError, failureCount, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(connectionId) DO UPDATE SET
            provider = excluded.provider, payload = excluded.payload, status = excluded.status,
            fetchedAt = excluded.fetchedAt, expiresAt = excluded.expiresAt,
            nextRefreshAt = excluded.nextRefreshAt, lastError = excluded.lastError,
            failureCount = excluded.failureCount, updatedAt = excluded.updatedAt`).run(
          input.connectionId, input.provider, JSON.stringify(input.payload), input.status,
          input.fetchedAt, input.expiresAt, input.nextRefreshAt, input.lastError,
          input.failureCount, updatedAt,
        );
        return this.get(input.connectionId)!;
      },
      remove(connectionId) {
        return sqlite.query("DELETE FROM quotaSnapshots WHERE connectionId = ?").run(connectionId).changes > 0;
      },
    },
    autoclawTasks: {
      get(connectionId, taskId, day) {
        const row = sqlite.query("SELECT * FROM autoclawTasks WHERE connectionId = ? AND taskId = ? AND day = ?").get(connectionId, taskId, day) as Record<string, unknown> | null;
        return row ? mapAutoclawTask(row) : null;
      },
      upsert(input) {
        const updatedAt = input.updatedAt || now();
        const payload = input.payload ?? {};
        sqlite.query(`INSERT INTO autoclawTasks
          (connectionId, taskId, day, status, rewardPoints, alreadyCompleted, error, payload, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(connectionId, taskId, day) DO UPDATE SET
            status = excluded.status, rewardPoints = excluded.rewardPoints,
            alreadyCompleted = excluded.alreadyCompleted, error = excluded.error,
            payload = excluded.payload, updatedAt = excluded.updatedAt`).run(
          input.connectionId, input.taskId, input.day, input.status,
          input.rewardPoints, input.alreadyCompleted ? 1 : 0, input.error,
          JSON.stringify(payload), updatedAt,
        );
        return this.get(input.connectionId, input.taskId, input.day)!;
      },
      listByConnection(connectionId) {
        return (sqlite.query("SELECT * FROM autoclawTasks WHERE connectionId = ? ORDER BY day DESC").all(connectionId) as Record<string, unknown>[]).map(mapAutoclawTask);
      },
      removeTask(connectionId, taskId) {
        return sqlite.query("DELETE FROM autoclawTasks WHERE connectionId = ? AND taskId = ?").run(connectionId, taskId).changes > 0;
      },
    },
    quotaWindows: {
      list(connectionId) {
        return (sqlite.query("SELECT * FROM quotaWindows WHERE connectionId = ? ORDER BY mode ASC").all(connectionId) as Record<string, unknown>[]).map(mapQuotaWindow);
      },
      get(connectionId, mode) {
        const row = sqlite.query("SELECT * FROM quotaWindows WHERE connectionId = ? AND mode = ?").get(connectionId, mode) as Record<string, unknown> | null;
        return row ? mapQuotaWindow(row) : null;
      },
      upsert(input) {
        const updatedAt = input.updatedAt || now();
        sqlite.query(`INSERT INTO quotaWindows
          (connectionId, mode, remaining, total, usagePercent, breakdown, windowSeconds, resetAt, syncedAt, source, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(connectionId, mode) DO UPDATE SET
            remaining = excluded.remaining, total = excluded.total, usagePercent = excluded.usagePercent,
            breakdown = excluded.breakdown, windowSeconds = excluded.windowSeconds,
            resetAt = excluded.resetAt, syncedAt = excluded.syncedAt, source = excluded.source,
            updatedAt = excluded.updatedAt`).run(
          input.connectionId, input.mode, input.remaining, input.total, input.usagePercent,
          JSON.stringify(input.breakdown), input.windowSeconds, input.resetAt, input.syncedAt,
          input.source, updatedAt,
        );
        return this.get(input.connectionId, input.mode)!;
      },
      listDue(nowTimestamp, limit) {
        return (sqlite.query("SELECT * FROM quotaWindows WHERE resetAt IS NOT NULL AND resetAt <= ? ORDER BY resetAt ASC LIMIT ?").all(nowTimestamp, limit) as Record<string, unknown>[]).map(mapQuotaWindow);
      },
      decrement(connectionId, mode, amount) {
        sqlite.query("UPDATE quotaWindows SET remaining = MAX(0, remaining - ?), usagePercent = CASE WHEN total > 0 THEN CAST((total - MAX(0, remaining - ?)) AS REAL) / total * 100 ELSE usagePercent END, updatedAt = ? WHERE connectionId = ? AND mode = ?").run(amount, amount, now(), connectionId, mode);
        return this.get(connectionId, mode);
      },
      remove(connectionId, mode) {
        return sqlite.query("DELETE FROM quotaWindows WHERE connectionId = ? AND mode = ?").run(connectionId, mode).changes > 0;
      },
      removeForConnection(connectionId) {
        return sqlite.query("DELETE FROM quotaWindows WHERE connectionId = ?").run(connectionId).changes;
      },
    },
    quotaRecovery: {
      list() {
        return (sqlite.query("SELECT * FROM quotaRecovery ORDER BY dueAt ASC").all() as Record<string, unknown>[]).map(mapQuotaRecovery);
      },
      listDue(nowTimestamp, limit) {
        return (sqlite.query("SELECT * FROM quotaRecovery WHERE dueAt <= ? ORDER BY dueAt ASC LIMIT ?").all(nowTimestamp, limit) as Record<string, unknown>[]).map(mapQuotaRecovery);
      },
      get(recoveryId) {
        const row = sqlite.query("SELECT * FROM quotaRecovery WHERE id = ?").get(recoveryId) as Record<string, unknown> | null;
        return row ? mapQuotaRecovery(row) : null;
      },
      getByConnection(connectionId, mode) {
        const row = sqlite.query("SELECT * FROM quotaRecovery WHERE connectionId = ? AND mode = ?").get(connectionId, mode) as Record<string, unknown> | null;
        return row ? mapQuotaRecovery(row) : null;
      },
      create(input) {
        const createdAt = input.createdAt || now();
        const updatedAt = input.updatedAt || createdAt;
        sqlite.query(`INSERT INTO quotaRecovery
          (id, connectionId, mode, dueAt, attempts, claimToken, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          input.id, input.connectionId, input.mode, input.dueAt, input.attempts,
          input.claimToken, createdAt, updatedAt,
        );
        return this.get(input.id)!;
      },
      incrementAttempts(recoveryId) {
        sqlite.query("UPDATE quotaRecovery SET attempts = attempts + 1, updatedAt = ? WHERE id = ?").run(now(), recoveryId);
        return this.get(recoveryId);
      },
      remove(recoveryId) {
        return sqlite.query("DELETE FROM quotaRecovery WHERE id = ?").run(recoveryId).changes > 0;
      },
      removeForConnection(connectionId) {
        return sqlite.query("DELETE FROM quotaRecovery WHERE connectionId = ?").run(connectionId).changes;
      },
    },
    rateLimitEvents: {
      list(connectionId, limit = 100) {
        return (sqlite.query("SELECT * FROM rateLimitEvents WHERE connectionId = ? ORDER BY createdAt DESC LIMIT ?").all(connectionId, limit) as Record<string, unknown>[]).map(mapRateLimitEvent);
      },
      create(input) {
        const createdAt = input.createdAt || now();
        sqlite.query(`INSERT INTO rateLimitEvents
          (connectionId, mode, statusCode, retryAfter, resetAt, message, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          input.connectionId, input.mode, input.statusCode, input.retryAfter,
          input.resetAt, input.message, createdAt,
        );
        const row = sqlite.query("SELECT * FROM rateLimitEvents WHERE id = last_insert_rowid()").get() as Record<string, unknown>;
        return mapRateLimitEvent(row);
      },
      removeOlderThan(timestamp) {
        return sqlite.query("DELETE FROM rateLimitEvents WHERE createdAt < ?").run(timestamp).changes;
      },
      removeForConnection(connectionId) {
        return sqlite.query("DELETE FROM rateLimitEvents WHERE connectionId = ?").run(connectionId).changes;
      },
    },
    connectionTestJobs: {
      create(input) {
        const timestamp = now();
        const jobId = id();
        const delayMs = Number.isFinite(input.delayMs) ? Math.max(0, Number(input.delayMs)) : 1000;
        sqlite.transaction(() => {
          sqlite.query(`INSERT INTO connectionTestJobs
            (id, providerId, status, delayMs, total, completed, passed, failed, currentConnectionId, error, createdAt, startedAt, finishedAt, updatedAt)
            VALUES (?, ?, 'queued', ?, ?, 0, 0, 0, NULL, NULL, ?, NULL, NULL, ?)`).run(
            jobId, input.providerId, delayMs, input.connectionIds.length, timestamp, timestamp,
          );
          input.connectionIds.forEach((connectionId, index) => {
            sqlite.query(`INSERT INTO connectionTestJobItems
              (id, jobId, connectionId, position, status, error, latencyMs, testedAt, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, 'queued', NULL, NULL, NULL, ?, ?)`).run(
              id(), jobId, connectionId, index, timestamp, timestamp,
            );
          });
        })();
        return this.get(jobId)!;
      },
      get(jobId) {
        const row = sqlite.query("SELECT * FROM connectionTestJobs WHERE id = ?").get(jobId) as Record<string, unknown> | null;
        if (!row) return null;
        const items = (sqlite.query("SELECT * FROM connectionTestJobItems WHERE jobId = ? ORDER BY position ASC").all(jobId) as Record<string, unknown>[]).map(mapConnectionTestJobItem);
        return mapConnectionTestJob(row, items);
      },
      latestForProvider(providerId) {
        const row = sqlite.query("SELECT * FROM connectionTestJobs WHERE providerId = ? ORDER BY createdAt DESC LIMIT 1").get(providerId) as Record<string, unknown> | null;
        return row ? this.get(String(row.id)) : null;
      },
      activeForProvider(providerId) {
        const row = sqlite.query(`SELECT * FROM connectionTestJobs
          WHERE providerId = ? AND (
            status IN ('queued', 'running')
            OR id IN (SELECT jobId FROM connectionTestJobItems WHERE status = 'testing')
          )
          ORDER BY createdAt DESC LIMIT 1`).get(providerId) as Record<string, unknown> | null;
        return row ? this.get(String(row.id)) : null;
      },
      claimNextQueued() {
        const row = sqlite.query("SELECT * FROM connectionTestJobs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1").get() as Record<string, unknown> | null;
        if (!row) return null;
        const timestamp = now();
        sqlite.query("UPDATE connectionTestJobs SET status = 'running', startedAt = COALESCE(startedAt, ?), updatedAt = ? WHERE id = ? AND status = 'queued'").run(timestamp, timestamp, String(row.id));
        return this.get(String(row.id));
      },
      markRunning(jobId, currentConnectionId) {
        const timestamp = now();
        sqlite.query("UPDATE connectionTestJobs SET status = 'running', currentConnectionId = ?, startedAt = COALESCE(startedAt, ?), updatedAt = ? WHERE id = ?").run(currentConnectionId, timestamp, timestamp, jobId);
        return this.get(jobId);
      },
      markItemTesting(jobId, connectionId) {
        const timestamp = now();
        sqlite.query("UPDATE connectionTestJobItems SET status = 'testing', updatedAt = ? WHERE jobId = ? AND connectionId = ?").run(timestamp, jobId, connectionId);
        sqlite.query("UPDATE connectionTestJobs SET currentConnectionId = ?, updatedAt = ? WHERE id = ?").run(connectionId, timestamp, jobId);
        const row = sqlite.query("SELECT * FROM connectionTestJobItems WHERE jobId = ? AND connectionId = ?").get(jobId, connectionId) as Record<string, unknown> | null;
        return row ? mapConnectionTestJobItem(row) : null;
      },
      markItemResult(jobId, connectionId, result) {
        const timestamp = now();
        sqlite.transaction(() => {
          sqlite.query("UPDATE connectionTestJobItems SET status = ?, error = ?, latencyMs = ?, testedAt = ?, updatedAt = ? WHERE jobId = ? AND connectionId = ?").run(
            result.status, result.error ?? null, result.latencyMs ?? null, timestamp, timestamp, jobId, connectionId,
          );
          const passedDelta = result.status === "success" ? 1 : 0;
          const failedDelta = result.status === "failed" ? 1 : 0;
          sqlite.query("UPDATE connectionTestJobs SET completed = completed + 1, passed = passed + ?, failed = failed + ?, currentConnectionId = NULL, updatedAt = ? WHERE id = ?").run(
            passedDelta, failedDelta, timestamp, jobId,
          );
        })();
        return this.get(jobId);
      },
      requestCancel(jobId) {
        const current = this.get(jobId);
        if (!current) return null;
        if (current.status === "completed" || current.status === "cancelled" || current.status === "failed") return current;
        const timestamp = now();
        sqlite.transaction(() => {
          sqlite.query("UPDATE connectionTestJobItems SET status = 'cancelled', updatedAt = ? WHERE jobId = ? AND status = 'queued'").run(timestamp, jobId);
          sqlite.query("UPDATE connectionTestJobs SET status = 'cancelled', currentConnectionId = NULL, finishedAt = COALESCE(finishedAt, ?), updatedAt = ? WHERE id = ?").run(timestamp, timestamp, jobId);
        })();
        return this.get(jobId);
      },
      finish(jobId, status, error) {
        const timestamp = now();
        sqlite.query("UPDATE connectionTestJobs SET status = ?, error = ?, currentConnectionId = NULL, finishedAt = COALESCE(finishedAt, ?), updatedAt = ? WHERE id = ?").run(
          status, error ?? null, timestamp, timestamp, jobId,
        );
        return this.get(jobId);
      },
      recoverInterrupted() {
        const timestamp = now();
        const running = sqlite.query("SELECT id FROM connectionTestJobs WHERE status IN ('queued', 'running')").all() as Array<{ id: string }>;
        sqlite.transaction(() => {
          sqlite.query("UPDATE connectionTestJobItems SET status = 'cancelled', updatedAt = ? WHERE status IN ('queued', 'testing') AND jobId IN (SELECT id FROM connectionTestJobs WHERE status IN ('queued', 'running'))").run(timestamp);
          sqlite.query("UPDATE connectionTestJobs SET status = 'cancelled', error = 'Interrupted by process restart', currentConnectionId = NULL, finishedAt = COALESCE(finishedAt, ?), updatedAt = ? WHERE status IN ('queued', 'running')").run(timestamp, timestamp);
        })();
        return running.length;
      },
    },
    nodes: {
      list() {
        return (sqlite.query("SELECT * FROM providerNodes ORDER BY createdAt ASC").all() as Record<string, unknown>[]).map(mapNode);
      },
      get(nodeId) {
        const row = sqlite.query("SELECT * FROM providerNodes WHERE id = ?").get(nodeId) as Record<string, unknown> | null;
        return row ? mapNode(row) : null;
      },
      create(input) {
        const timestamp = now();
        const type = String(input.type || "openai-compatible");
        const idPrefix = type === "openai-compatible" ? `openai-compatible-${input.apiType}-` : type === "anthropic-compatible" ? "anthropic-compatible-" : "custom-embedding-";
        const node = { id: String(input.id || `${idPrefix}${id()}`), type, name: String(input.name || input.id || "Node"), data: JSON.stringify({ ...(input.data as object || {}), prefix: input.prefix || null, ...(input.apiType ? { apiType: input.apiType } : {}), baseUrl: input.baseUrl || null }), createdAt: timestamp, updatedAt: timestamp };
        sqlite.query(`INSERT INTO providerNodes (id, type, name, data, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?)`).run(node.id, node.type, node.name, node.data, node.createdAt, node.updatedAt);
        invalidateCustomNodes();
        return this.get(node.id)!;
      },
      update(nodeId, input) {
        const current = this.get(nodeId);
        if (!current) return null;
        const next: Record<string, any> = { ...current, ...input, updatedAt: now() };
        const { id: _id, type: _type, name: _name, createdAt: _createdAt, updatedAt: _updatedAt, ...currentData } = current;
        sqlite.query(`UPDATE providerNodes SET type = ?, name = ?, data = ?, updatedAt = ? WHERE id = ?`).run(
          next.type, next.name, JSON.stringify({ ...currentData, ...(next.data as object || {}), prefix: next.prefix, ...(next.apiType ? { apiType: next.apiType } : {}), baseUrl: next.baseUrl }), next.updatedAt, nodeId,
        );
        invalidateCustomNodes();
        return this.get(nodeId);
      },
      remove(nodeId) {
        const result = sqlite.transaction(() => {
          sqlite.query("DELETE FROM providerConnections WHERE provider = ?").run(nodeId);
          return sqlite.query("DELETE FROM providerNodes WHERE id = ?").run(nodeId).changes > 0;
        })();
        if (result && providerRows) providerRows = providerRows.filter((row) => row.provider !== nodeId);
        invalidateCustomNodes();
        return result;
      },
    },
    proxies: {
      list() { return sqlite.query("SELECT * FROM proxyPools ORDER BY createdAt DESC").all() as Record<string, unknown>[]; },
      get(poolId) { return sqlite.query("SELECT * FROM proxyPools WHERE id = ?").get(poolId) as Record<string, unknown> | null; },
      create(input) { const timestamp = now(); const pool = { id: String(input.id || id()), isActive: input.isActive === false ? 0 : 1, testStatus: String(input.testStatus || "unknown"), data: JSON.stringify({ ...(input.data as object || {}), name: input.name || "Proxy pool", proxyUrl: input.proxyUrl || "" }), createdAt: timestamp, updatedAt: timestamp }; sqlite.query("INSERT INTO proxyPools (id, isActive, testStatus, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(pool.id, pool.isActive, pool.testStatus, pool.data, pool.createdAt, pool.updatedAt); return this.get(pool.id)!; },
      update(poolId, input) { const current = this.get(poolId); if (!current) return null; const currentData = json<Record<string, unknown>>(current.data, {}); const next: Record<string, any> = { ...current, ...input }; const data = { ...currentData, ...(next.data || {}), ...(next.name ? { name: next.name } : {}), ...(next.proxyUrl ? { proxyUrl: next.proxyUrl } : {}) }; sqlite.query("UPDATE proxyPools SET isActive = ?, testStatus = ?, data = ?, updatedAt = ? WHERE id = ?").run(next.isActive === false ? 0 : 1, next.testStatus || "unknown", JSON.stringify(data), now(), poolId); return this.get(poolId); },
      remove(poolId) { return sqlite.query("DELETE FROM proxyPools WHERE id = ?").run(poolId).changes > 0; },
    },
    keys: {
      list() {
        return (sqlite.query("SELECT * FROM apiKeys ORDER BY createdAt DESC").all() as Record<string, unknown>[]).map((row) => {
          const record = mapKey(row);
          const cached = keysById.get(record.id);
          return cached ? { ...cached } : withPendingKeyUsage(record);
        });
      },
      getSecret(keyId) {
        const row = sqlite.query("SELECT key FROM apiKeys WHERE id = ?").get(keyId) as { key?: string } | null;
        return row?.key || null;
      },
      getByKey(key) {
        if (keysBySecret.has(key)) {
          const cached = keysBySecret.get(key);
          if (!cached) return null;
          if (!cached.isActive) return null;
          if (cached.visibility === "event" && cached.status !== "submitted") return null;
          return { ...cached };
        }
        const row = sqlite.query("SELECT * FROM apiKeys WHERE key = ? AND isActive = 1").get(key) as Record<string, unknown> | null;
        if (!row) {
          keysBySecret.set(key, null);
          return null;
        }
        const record = withPendingKeyUsage(mapKey(row));
        cacheKey(record);
        if (record.visibility === "event" && record.status !== "submitted") return null;
        return { ...record };
      },
      // The connect endpoint hands the raw default public key to local clients.
      getDefaultPublicKey() {
        const row = sqlite.query("SELECT * FROM apiKeys WHERE visibility = 'public' AND isDefault = 1 AND isActive = 1 LIMIT 1").get() as Record<string, unknown> | null;
        return row ? { record: mapKey(row), key: String(row.key || "") } : null;
      },
      create(input) {
        const key = String(input.key || `sk-${crypto.randomUUID().replaceAll("-", "")}`);
        const timestamp = now();
        const maxConcurrency = input.maxConcurrency == null ? null : Math.max(0, Math.floor(Number(input.maxConcurrency)) || 0) || null;
        const record = { id: String(input.id || id()), key, keyPrefix: input.keyPrefix == null ? key.slice(0, 12) : String(input.keyPrefix), name: input.name == null ? null : String(input.name), isActive: input.isActive === false || input.isActive === 0 ? 0 : 1, visibility: String(input.visibility || "private"), isDefault: input.isDefault ? 1 : 0, comboAccessMode: String(input.comboAccessMode || "blacklist"), comboAccessList: JSON.stringify(input.comboAccessList || []), modelAccessMode: String(input.modelAccessMode || "whitelist"), modelAccessList: JSON.stringify(input.modelAccessList || []), limitMode: String(input.limitMode || "none"), limitValue: input.limitValue == null ? null : Number(input.limitValue), maxConcurrency, status: String(input.status || "submitted"), connectionPins: JSON.stringify(input.connectionPins || {}), features: JSON.stringify(input.features || {}), createdAt: timestamp };
        if (record.isDefault) sqlite.query("UPDATE apiKeys SET isDefault = 0 WHERE visibility = 'public'").run();
        sqlite.query(`INSERT INTO apiKeys (id, key, name, machineId, isActive, comboAccessMode, comboAccessList, modelAccessMode, modelAccessList, visibility, isDefault, limitMode, limitValue, maxConcurrency, status, connectionPins, usageRequests, usageTokens, features, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.key, record.name, input.machineId || null, record.isActive, record.comboAccessMode, record.comboAccessList, record.modelAccessMode, record.modelAccessList, record.visibility, record.isDefault, record.limitMode, record.limitValue, record.maxConcurrency, record.status, record.connectionPins, 0, 0, record.features, record.createdAt);
        const created = mapKey(sqlite.query("SELECT * FROM apiKeys WHERE id = ?").get(record.id) as Record<string, unknown>);
        cacheKey(created);
        return { record: created, key };
      },
      update(keyId, patch) {
        flushUsageWrites();
        const current = sqlite.query("SELECT * FROM apiKeys WHERE id = ?").get(keyId) as Record<string, unknown> | null;
        if (!current) return null;
        const currentKey = mapKey(current);
        const next = { ...currentKey, ...patch } as Record<string, unknown>;
        next.visibility = currentKey.visibility;
        next.comboAccessMode = next.comboAccessMode === "whitelist" ? "whitelist" : "blacklist";
        next.comboAccessList = Array.isArray(next.comboAccessList) ? Array.from(new Set(next.comboAccessList.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))) : [];
        next.modelAccessMode = next.modelAccessMode === "blacklist" ? "blacklist" : "whitelist";
        next.modelAccessList = Array.isArray(next.modelAccessList) ? Array.from(new Set(next.modelAccessList.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))) : [];
        const requestedLimitMode = next.limitMode === "requests" || next.limitMode === "tokens" ? next.limitMode : "none";
        const requestedLimitValue = Number(next.limitValue);
        next.limitMode = requestedLimitMode === "none" || !Number.isFinite(requestedLimitValue) || requestedLimitValue <= 0 ? "none" : requestedLimitMode;
        next.limitValue = next.limitMode === "none" ? null : Math.floor(requestedLimitValue);
        next.features = patch.features && typeof patch.features === "object" && !Array.isArray(patch.features)
          ? { ...currentKey.features, ...(patch.features as Record<string, unknown>) }
          : currentKey.features;
        if (patch.maxConcurrency !== undefined) {
          const raw = Number(patch.maxConcurrency);
          next.maxConcurrency = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
        } else {
          next.maxConcurrency = currentKey.maxConcurrency;
        }
        if (patch.connectionPins !== undefined && patch.connectionPins && typeof patch.connectionPins === "object" && !Array.isArray(patch.connectionPins)) {
          next.connectionPins = patch.connectionPins;
        } else {
          next.connectionPins = currentKey.connectionPins;
        }
        if (patch.status !== undefined && ["draft", "submitted", "revoked"].includes(String(patch.status))) {
          next.status = String(patch.status);
        } else {
          next.status = currentKey.status;
        }
        next.isDefault = currentKey.visibility === "public" && patch.isDefault === true
          ? true
          : patch.isDefault === false
            ? false
            : currentKey.isDefault;
        if (patch.resetUsage === true) {
          flushUsageWrites();
          keyUsageDeltas.delete(keyId);
          sqlite.query("UPDATE apiKeys SET usageRequests = 0, usageTokens = 0 WHERE id = ?").run(keyId);
          next.usageRequests = 0;
          next.usageTokens = 0;
        } else {
          next.usageRequests = currentKey.usageRequests;
          next.usageTokens = currentKey.usageTokens;
        }
        if (next.isDefault) sqlite.query("UPDATE apiKeys SET isDefault = 0 WHERE isDefault = 1").run();
        sqlite.query(`UPDATE apiKeys SET name = ?, isActive = ?, visibility = ?, isDefault = ?, comboAccessMode = ?, comboAccessList = ?, modelAccessMode = ?, modelAccessList = ?, limitMode = ?, limitValue = ?, maxConcurrency = ?, status = ?, connectionPins = ?, usageRequests = ?, usageTokens = ?, features = ? WHERE id = ?`).run(
          next.name ?? null, next.isActive === false ? 0 : 1, next.visibility, next.isDefault ? 1 : 0, next.comboAccessMode, JSON.stringify(next.comboAccessList), next.modelAccessMode, JSON.stringify(next.modelAccessList), next.limitMode, next.limitValue, next.maxConcurrency, next.status, JSON.stringify(next.connectionPins || {}), next.usageRequests, next.usageTokens, JSON.stringify(next.features || {}), keyId,
        );
        const updated = mapKey(sqlite.query("SELECT * FROM apiKeys WHERE id = ?").get(keyId) as Record<string, unknown>);
        dropKey(currentKey);
        cacheKey(updated);
        return updated;
      },
      remove(keyId) {
        const current = sqlite.query("SELECT id, key FROM apiKeys WHERE id = ?").get(keyId) as { id?: string; key?: string } | null;
        const removed = sqlite.query("DELETE FROM apiKeys WHERE id = ?").run(keyId).changes > 0;
        if (removed) {
          keyUsageDeltas.delete(keyId);
          dropKey(current);
        }
        return removed;
      },
      incrementUsage(keyId, tokens) {
        bumpKeyUsage(keyId, tokens);
      },
      invalidateCache() {
        keysById.clear();
        keysBySecret.clear();
      },
    },
    aliases: {
      list() {
        const rows = sqlite.query("SELECT key, value FROM kv WHERE scope = 'modelAliases'").all() as { key: string; value: string }[];
        return Object.fromEntries(rows.map((row) => [row.key, String(json(row.value, row.value))]));
      },
      set(alias, targetModel) { sqlite.query("INSERT INTO kv (scope, key, value) VALUES ('modelAliases', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value").run(alias, JSON.stringify(targetModel)); },
      remove(alias) { return sqlite.query("DELETE FROM kv WHERE scope = 'modelAliases' AND key = ?").run(alias).changes > 0; },
    },
    combos: {
       list() { return sqlite.query("SELECT * FROM combos ORDER BY name ASC").all() as Record<string, unknown>[]; },
       get(value) { return sqlite.query("SELECT * FROM combos WHERE id = ? OR name = ?").get(value, value) as Record<string, unknown> | null; },
        create(input) { const timestamp = now(); const combo = { id: String(input.id || id()), name: String(input.name), kind: input.kind == null ? null : String(input.kind), models: JSON.stringify(input.models || []), identityEnabled: input.identityEnabled ? 1 : 0, accountFilters: JSON.stringify(input.accountFilters || {}), useCustomAccountOrder: input.useCustomAccountOrder ? 1 : 0, capabilities: JSON.stringify(input.capabilities || {}), createdAt: timestamp, updatedAt: timestamp }; sqlite.query(`INSERT INTO combos (id, name, kind, models, identityEnabled, accountFilters, useCustomAccountOrder, capabilities, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(combo.id, combo.name, combo.kind, combo.models, combo.identityEnabled, combo.accountFilters, combo.useCustomAccountOrder, combo.capabilities, combo.createdAt, combo.updatedAt); return this.get(combo.id)!; },
        update(comboId, input) { const current = this.get(comboId); if (!current) return null; const next = { ...current, ...input }; sqlite.query("UPDATE combos SET name = ?, kind = ?, models = ?, identityEnabled = ?, accountFilters = ?, useCustomAccountOrder = ?, capabilities = ?, updatedAt = ? WHERE id = ?").run(next.name, next.kind == null ? null : next.kind, typeof next.models === "string" ? next.models : JSON.stringify(next.models || []), next.identityEnabled ? 1 : 0, typeof next.accountFilters === "string" ? next.accountFilters : JSON.stringify(next.accountFilters || {}), next.useCustomAccountOrder ? 1 : 0, typeof next.capabilities === "string" ? next.capabilities : JSON.stringify(next.capabilities || {}), now(), comboId); return this.get(comboId); },
      remove(comboId) { return sqlite.query("DELETE FROM combos WHERE id = ?").run(comboId).changes > 0; },
    },
    visionAdapters: {
      list() { return (sqlite.query("SELECT * FROM visionAdapters ORDER BY name ASC").all() as Record<string, unknown>[]).map((row) => ({ ...row, models: JSON.parse(String(row.models || "[]")), isGlobal: row.isGlobal === 1 })); },
      get(adapterId) { const row = sqlite.query("SELECT * FROM visionAdapters WHERE id = ?").get(adapterId) as Record<string, unknown> | null; return row ? { ...row, models: JSON.parse(String(row.models || "[]")), isGlobal: row.isGlobal === 1 } : null; },
      getGlobal() { const row = sqlite.query("SELECT * FROM visionAdapters WHERE isGlobal = 1").get() as Record<string, unknown> | null; return row ? { ...row, models: JSON.parse(String(row.models || "[]")), isGlobal: true } : null; },
      create(input) { const timestamp = now(); const adapter = { id: String(input.id || id()), name: String(input.name), models: JSON.stringify(input.models || []), isGlobal: input.isGlobal ? 1 : 0, createdAt: timestamp, updatedAt: timestamp }; sqlite.query("INSERT INTO visionAdapters (id, name, models, isGlobal, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)").run(adapter.id, adapter.name, adapter.models, adapter.isGlobal, adapter.createdAt, adapter.updatedAt); return this.get(adapter.id)!; },
      update(adapterId, input) { const current = this.get(adapterId); if (!current) return null; const next = { ...current, ...input }; sqlite.query("UPDATE visionAdapters SET name = ?, models = ?, isGlobal = ?, updatedAt = ? WHERE id = ?").run(next.name, typeof next.models === "string" ? next.models : JSON.stringify(next.models || []), next.isGlobal ? 1 : 0, now(), adapterId); return this.get(adapterId); },
      remove(adapterId) { return sqlite.query("DELETE FROM visionAdapters WHERE id = ?").run(adapterId).changes > 0; },
      setGlobal(adapterId) { const adapter = this.get(adapterId); if (!adapter) return false; sqlite.query("UPDATE visionAdapters SET isGlobal = 0").run(); sqlite.query("UPDATE visionAdapters SET isGlobal = 1, updatedAt = ? WHERE id = ?").run(now(), adapterId); return true; },
      clearGlobal() { sqlite.query("UPDATE visionAdapters SET isGlobal = 0").run(); return true; },
    },
    models: {
      list(kind = "chat") { return this.all().filter((model) => !kind || kind === "chat" || String(model.kind || "llm") === kind); },
      all() { const rows = sqlite.query("SELECT * FROM models WHERE source = 'custom' ORDER BY provider, sortOrder, name").all() as Array<Record<string, unknown>>; return rows.map(customModelRow); },
      catalog() { const rows = sqlite.query("SELECT * FROM models ORDER BY provider, sortOrder, name").all() as Array<Record<string, unknown>>; return rows.map(catalogModelRow); },
      search(input: any = {}) {
        const query = String(input.query || "").trim();
        const provider = String(input.provider || "").trim();
        const kind = String(input.kind || "").trim();
        const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (query) {
          const like = `%${query}%`;
          conditions.push("(name LIKE ? OR modelId LIKE ? OR providerAlias LIKE ? OR id LIKE ?)");
          values.push(like, like, like, like);
        }
        if (provider) { conditions.push("(provider = ? OR providerAlias = ?)"); values.push(provider, provider); }
        if (kind) { conditions.push("kind = ?"); values.push(kind); }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = sqlite.query(`SELECT * FROM models ${where} ORDER BY provider, sortOrder, name LIMIT ?`).all(...values, limit) as Array<Record<string, unknown>>;
        return rows.map(catalogModelRow);
      },
      upsert(input) {
        const modelId = String(input.id || input.model || "").trim();
        const providerAlias = String(input.providerAlias || input.provider || "custom");
        const kind = String(input.kind || input.type || "llm");
        const capabilities = input.capabilities && typeof input.capabilities === "object" ? JSON.stringify(input.capabilities) : "{}";
        if (!modelId) return input as Record<string, unknown>;
        const compositeId = `${providerAlias}/${modelId}`;
        const timestamp = now();
        sqlite.query(`INSERT INTO models (id, provider, providerAlias, modelId, name, kind, source, capabilities, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 'custom', ?, 999, ?, ?) ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, providerAlias = excluded.providerAlias, modelId = excluded.modelId, name = excluded.name, kind = excluded.kind, capabilities = excluded.capabilities, updatedAt = excluded.updatedAt`).run(
          compositeId, providerAlias, providerAlias, modelId, String(input.name || modelId), kind, capabilities, timestamp, timestamp,
        );
        return customModelRow({ id: compositeId, provider: providerAlias, providerAlias, modelId, name: String(input.name || modelId), kind, source: "custom", capabilities });
      },
      setDisabled() { return null; },
      remove(modelId) { const value = String(modelId); return sqlite.query("DELETE FROM models WHERE source = 'custom' AND (id = ? OR modelId = ?)").run(value, value).changes > 0; },
    },
    usage: {
      // Canonicalize the raw upstream usage ON WRITE so every consumer
      // (summary columns, usageTokenCounts, cost) reads one consistent
      // convention: prompt_tokens is cache-inclusive and cached_tokens is a
      // top-level key. This mirrors v1's canonicalizeUsage invariant; without
      // it the summary column, dashboard recompute, and cost diverge for
      // Claude cache-reads and OpenAI/Responses nested cache metadata.
      record(input) {
        const raw = input.tokens && typeof input.tokens === "object" && !Array.isArray(input.tokens) ? input.tokens as Record<string, unknown> : {};
        // When callers supply only scalar counts (no tokens envelope), build a
        // token-shaped object so canonicalization keeps their values.
        const hasRawTokens = Object.keys(raw).length > 0;
        const base = hasRawTokens
          ? raw
          : { prompt_tokens: input.promptTokens, completion_tokens: input.completionTokens };
        const canonical = canonicalizeUsage(base);
        const tokens = (canonical ?? base) as Record<string, any>;
        const promptTokens = numberValue(tokens.prompt_tokens ?? tokens.input_tokens ?? input.promptTokens);
        const completionTokens = numberValue(tokens.completion_tokens ?? tokens.output_tokens ?? input.completionTokens);
        const resolvedPricing = resolvePricing(input.provider == null ? null : String(input.provider), input.model == null ? null : String(input.model));
        const calculatedCost = resolvedPricing ? calculateCostFromTokens(tokens, resolvedPricing) : 0;
        const cost = input.cost == null ? calculatedCost : numberValue(input.cost);
        const meta = input.meta || {};
        const status = String(input.status || "success");
        const facts = usageFacts({ tokens, meta, status, prompt_tokens: promptTokens, completion_tokens: completionTokens });
        enqueueUsage({
          timestamp: String(input.timestamp || now()),
          provider: input.provider == null ? null : String(input.provider),
          model: input.model == null ? null : String(input.model),
          connectionId: input.connectionId == null ? null : String(input.connectionId),
          apiKey: input.apiKey == null ? null : String(input.apiKey),
          endpoint: input.endpoint == null ? null : String(input.endpoint),
          clientIp: input.clientIp == null ? null : String(input.clientIp),
          promptTokens,
          completionTokens,
          cost,
          status,
          tokens: JSON.stringify(tokens),
          meta: JSON.stringify(meta),
          cachedTokens: facts.cachedTokens,
          comboName: facts.comboName,
          failed: facts.failed,
          successTps: facts.successTps,
          successLatencyMs: facts.successLatencyMs,
        });
      },
      flush: stopUsageWrites,
      rollupBefore(cutoff, limit) {
        usageReady();
        return rollupUsageBefore(sqlite, cutoff, limit, localDateKey);
      },
      events: usageEvents,
      pendingStart(connectionId, model, provider, apiKey) {
        const key = `${model} (${provider})`;
        const timerKey = `${connectionId}:${key}`;
        const models = pendingByAccount.get(connectionId) || new Map<string, number>();
        models.set(key, (models.get(key) || 0) + 1);
        pendingByAccount.set(connectionId, models);
        if (apiKey) pendingByApiKey.set(apiKey, (pendingByApiKey.get(apiKey) || 0) + 1);
        // (Re)arm the leak-protection timer; clear it on pendingEnd.
        const previous = pendingTimers.get(timerKey);
        if (previous) clearTimeout(previous.timer);
        pendingTimers.set(timerKey, {
          timer: setTimeout(() => {
            pendingTimers.delete(timerKey);
            const acc = pendingByAccount.get(connectionId);
            if (acc) { acc.delete(key); if (!acc.size) pendingByAccount.delete(connectionId); }
            if (apiKey) releasePendingKey(apiKey);
            usageEvents.emit("pending");
          }, PENDING_TIMEOUT_MS),
          apiKey: apiKey || null,
        });
        usageEvents.emit("pending");
      },
      pendingEnd(connectionId, model, provider, apiKey) {
        const key = `${model} (${provider})`;
        const timerKey = `${connectionId}:${key}`;
        const timer = pendingTimers.get(timerKey);
        if (timer) clearTimeout(timer.timer);
        pendingTimers.delete(timerKey);
        const models = pendingByAccount.get(connectionId);
        if (models) {
          const count = (models.get(key) || 1) - 1;
          if (count > 0) models.set(key, count);
          else models.delete(key);
          if (!models.size) pendingByAccount.delete(connectionId);
          usageEvents.emit("pending");
        }
        if (apiKey) releasePendingKey(apiKey);
      },
      pendingSnapshot() { return pendingByAccount; },
      pendingKeySnapshot() { return pendingByApiKey; },
      noteError(provider) { lastErrorProvider = { provider, ts: Date.now() }; },
      errorProviderWindow() { return Date.now() - lastErrorProvider.ts < 10_000 ? lastErrorProvider.provider : ""; },
      list(limit = 100) {
        usageReady();
        return usageRowsPage(sqlite, {}, Math.min(limit, 1000)).rows;
      },
      history({ limit = 100, cursor = null } = {}) {
        usageReady();
        const page = usageRowsPage(sqlite, {}, Math.min(limit, 1000), cursor);
        return { items: page.rows, nextCursor: page.nextCursor };
      },
      requestDetails(filter: any = {}) {
        const page = Math.max(1, Math.floor(Number(filter.page) || 1));
        const pageSize = Math.min(100, Math.max(1, Math.floor(Number(filter.pageSize) || 20)));
        const conditions: string[] = [];
        const values: unknown[] = [];
        for (const [column, value] of [["provider", filter.provider], ["model", filter.model], ["connectionId", filter.connectionId], ["status", filter.status]] as const) {
          if (value) { conditions.push(`${column} = ?`); values.push(value); }
        }
        // Same success rule as isSuccessStatus: empty, "ok" and "success" count as success.
        if (filter.outcome === "success") conditions.push("(status IS NULL OR LOWER(status) IN ('', 'ok', 'success'))");
        if (filter.outcome === "error") conditions.push("(status IS NOT NULL AND LOWER(status) NOT IN ('', 'ok', 'success'))");
        const search: string = typeof filter.search === "string" ? filter.search.trim() : "";
        if (search) {
          const pattern = `%${search.replace(/[\\%_]/g, (char: string) => `\\${char}`)}%`;
          conditions.push("(model LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\')");
          values.push(pattern, pattern);
        }
        if (filter.startDate) { conditions.push("timestamp >= ?"); values.push(new Date(filter.startDate).toISOString()); }
        if (filter.endDate) { conditions.push("timestamp <= ?"); values.push(new Date(filter.endDate).toISOString()); }
        const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
        const totalItems = Number((sqlite.query(`SELECT COUNT(*) AS count FROM requestDetails${where}`).get(...values) as { count: number }).count || 0);
        const rows = sqlite.query(`SELECT data FROM requestDetails${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize) as Array<{ data: string }>;
        const totalPages = Math.ceil(totalItems / pageSize);
        return { details: rows.map((row) => json<Record<string, unknown>>(row.data, {})), pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } };
      },
      requestDetail(id) {
        const row = sqlite.query("SELECT data FROM requestDetails WHERE id = ?").get(id) as { data?: string } | null;
        return row?.data ? json<Record<string, unknown>>(row.data, {}) : null;
      },
      summary(period = "all") {
        usageReady();
        const valid = ["today", "1h", "24h", "7d", "30d", "60d", "all"];
        const totals = usageTotals(sqlite, periodScope(valid.includes(period) ? period : "all"));
        return { requests: totals.requests, prompt_tokens: totals.promptTokens, completion_tokens: totals.completionTokens, cost: totals.cost, cached_tokens: totals.cachedTokens, total_tokens: totals.promptTokens + totals.completionTokens };
      },
      overview(period = "24h", modelLimit = 16) {
        const normalized = ["today", "1h", "24h", "7d", "30d", "60d", "all"].includes(period) ? period : "24h";
        const limit = Math.max(1, Math.min(50, Math.floor(Number(modelLimit) || 16)));
        usageReady();
        const scope = periodScope(normalized);
        const measure = (totals: UsageTotals) => ({
          requests: totals.requests,
          tokens: totals.promptTokens + totals.completionTokens,
          cost: totals.cost,
          failed: totals.failed,
          successRate: totals.requests ? (totals.requests - totals.failed) / totals.requests : null,
        });
        const totals = measure(usageTotals(sqlite, scope));

        // Previous window: same length, ending where this one starts.
        let previous: UsageOverview["previous"] = null;
        const startIso = periodStart(normalized);
        if (startIso) {
          const start = new Date(startIso).getTime();
          const prevStart = new Date(start - (Date.now() - start)).toISOString();
          const before = measure(usageTotals(sqlite, { since: prevStart, before: startIso }));
          previous = { requests: before.requests, tokens: before.tokens, cost: before.cost, successRate: before.successRate };
        }

        // Buckets use the trend() calendar so both endpoints line up.
        const calendar = usageCalendar(normalized, scope);
        const slotted = aggregateUsage(sqlite, scope, { buckets: calendar.ranges });
        const { labels, slotOf } = calendar.compact(slotted);
        const buckets = labels.map(() => ({ requests: 0, failed: 0, tokens: 0, cost: 0 }));
        for (const group of slotted) {
          const bucket = buckets[slotOf(group.bucket as number)];
          if (!bucket) continue;
          bucket.requests += group.requests;
          bucket.failed += group.failed;
          bucket.tokens += group.promptTokens + group.completionTokens;
          bucket.cost += group.cost;
        }

        const providers = new Map<string, { cost: number; requests: number }>();
        const models = new Map<string, { requests: number; promptTokens: number; completionTokens: number; cost: number; failed: number }>();
        for (const group of aggregateUsage(sqlite, scope, { by: ["provider", "model"] })) {
          const provider = providerKey(group.keys);
          const entry = providers.get(provider) || { cost: 0, requests: 0 };
          entry.cost += group.cost; entry.requests += group.requests;
          providers.set(provider, entry);
          const modelId = group.keys.provider && group.keys.model ? `${group.keys.provider}/${group.keys.model}` : String(group.keys.model || "unknown");
          const model = models.get(modelId) || { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, failed: 0 };
          model.requests += group.requests; model.promptTokens += group.promptTokens; model.completionTokens += group.completionTokens; model.cost += group.cost; model.failed += group.failed;
          models.set(modelId, model);
        }
        let peak: UsageOverview["peak"] = null;
        buckets.forEach((bucket, index) => { if (bucket.requests > 0 && (!peak || bucket.requests > peak.requests)) peak = { label: labels[index], requests: bucket.requests }; });
        return {
          period: normalized,
          totals: { requests: totals.requests, tokens: totals.tokens, cost: totals.cost, successRate: totals.successRate, failed: totals.failed },
          previous,
          labels,
          buckets,
          peak,
          costByProvider: [...providers.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.cost - a.cost || b.requests - a.requests),
          models: [...models.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.requests - a.requests).slice(0, limit),
        };
      },
      trend(by, period = "7d", top = 5, apiKey) {
        const normalized = ["today", "1h", "24h", "7d", "30d", "60d", "all"].includes(period) ? period : "7d";
        const limit = Math.max(1, Math.min(10, Math.floor(Number(top) || 5)));
        usageReady();
        // With an api key the trend only covers that key, so a public page can never see other keys' traffic.
        const scope = periodScope(normalized, apiKey ? { apiKey } : {});
        const dimensions: Record<UsageTrendBy, UsageDimension[]> = { provider: ["provider"], account: ["connectionId"], apiKey: ["apiKey"], combo: ["comboName"], publicModel: ["comboName", "model"], model: ["provider", "model"] };
        const entityOf = (keys: UsageKeys): string => {
          if (by === "provider") return providerKey(keys);
          if (by === "account") return keys.connectionId || "unknown";
          if (by === "apiKey") return keys.apiKey || "unknown";
          if (by === "combo") return keys.comboName || "";
          if (by === "publicModel") return publicModelName(keys.comboName, keys.model);
          return modelKey(keys);
        };
        const calendar = usageCalendar(normalized, scope);
        const groups = aggregateUsage(sqlite, scope, { by: dimensions[by] || dimensions.model, buckets: calendar.ranges });
        const { labels, slotOf } = calendar.compact(groups);
        const entities = new Map<string, { tokens: number[]; requests: number[]; total: number }>();
        for (const group of groups) {
          const entity = entityOf(group.keys);
          if (!entity) continue;
          const index = slotOf(group.bucket as number);
          if (index < 0) continue;
          const tokens = group.promptTokens + group.completionTokens;
          const item = entities.get(entity) || { tokens: labels.map(() => 0), requests: labels.map(() => 0), total: 0 };
          item.tokens[index] += tokens;
          item.requests[index] += group.requests;
          item.total += tokens;
          entities.set(entity, item);
        }
        const ranked = [...entities.entries()].sort((left, right) => right[1].total - left[1].total);
        const series = ranked.slice(0, limit).map(([id, item]) => ({ id, tokens: item.tokens, requests: item.requests }));
        const rest = ranked.slice(limit);
        if (rest.length) {
          series.push({
            id: OTHER_SERIES_ID,
            tokens: labels.map((_, index) => rest.reduce((total, [, item]) => total + item.tokens[index], 0)),
            requests: labels.map((_, index) => rest.reduce((total, [, item]) => total + item.requests[index], 0)),
          });
        }
        return { period: normalized, labels, series };
      },
      dashboard(period = "7d") {
        const normalized = ["today", "1h", "24h", "7d", "30d", "60d", "all"].includes(period) ? period : "7d";
        const isMinute = normalized === "1h";
        const isHourly = normalized === "today" || normalized === "24h" || isMinute;
        const rolling = normalized === "24h" || isMinute;
        let bucketCount = isMinute ? MINUTE_BUCKETS : isHourly ? 24 : normalized === "30d" ? 30 : normalized === "60d" ? 60 : 7;
        const bucketMs = isMinute ? MINUTE_BUCKET_MS : isHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
        const start = rolling ? new Date(Date.now() - bucketCount * bucketMs) : new Date();
        if (!rolling) start.setHours(0, 0, 0, 0);
        if (!isHourly && normalized !== "all") start.setDate(start.getDate() - bucketCount + 1);
        usageReady();
        const scope = periodScope(normalized);
        if (normalized === "all") {
          const { oldest } = usageTimeRange(sqlite, scope);
          if (oldest) {
            start.setTime(new Date(oldest).getTime());
            start.setHours(0, 0, 0, 0);
            bucketCount = Math.max(1, Math.ceil((Date.now() - start.getTime()) / bucketMs));
          }
        }
        const startTime = start.getTime();
        const endTime = rolling ? Date.now() : startTime + bucketCount * bucketMs;
        const buckets = Array.from({ length: bucketCount }, (_, index) => ({
          label: isHourly
            ? new Date(startTime + index * bucketMs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
            : new Date(startTime + index * bucketMs).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          requests: 0,
          tokens: 0,
          cost: 0,
        }));
        const ranges = buckets.map((_, index): [string, string] => {
          const from = startTime + index * bucketMs;
          return [new Date(from).toISOString(), new Date(Math.min(from + bucketMs, endTime)).toISOString()];
        });
        const providerCounts = new Map<string, number>();
        const modelCounts = new Map<string, number>();
        let totalRequests = 0;
        let totalTokens = 0;
        let totalCost = 0;
        for (const group of aggregateUsage(sqlite, scope, { by: ["provider", "model"], buckets: ranges })) {
          const bucket = buckets[group.bucket as number];
          const tokens = group.promptTokens + group.completionTokens;
          bucket.requests += group.requests;
          bucket.tokens += tokens;
          bucket.cost += group.cost;
          totalRequests += group.requests;
          totalTokens += tokens;
          totalCost += group.cost;
          const provider = providerKey(group.keys);
          const model = group.keys.model || "unknown";
          providerCounts.set(provider, (providerCounts.get(provider) || 0) + group.requests);
          modelCounts.set(model, (modelCounts.get(model) || 0) + group.requests);
        }
        const top = (values: Map<string, number>) => {
          const entry = [...values.entries()].sort((left, right) => right[1] - left[1])[0];
          return entry ? { name: entry[0], requests: entry[1] } : null;
        };
        return { period: normalized, buckets, totals: { requests: totalRequests, tokens: totalTokens, cost: totalCost }, topProvider: top(providerCounts), topModel: top(modelCounts) };
      },
      chart(period = "7d") {
        const normalized = ["today", "1h", "24h", "7d", "30d", "60d", "all"].includes(period) ? period : "7d";
        const nowMs = Date.now();
        usageReady();
        const scope = periodScope(normalized);
        const iso = (ms: number) => new Date(ms).toISOString();
        // Fixed-width buckets up to now. The last bucket also takes rows that
        // pass its nominal end, up to now.
        const timedBuckets = (startTime: number, count: number, bucketMs: number, label: (date: Date) => string) => {
          const buckets = Array.from({ length: count }, (_, index) => ({ label: label(new Date(startTime + index * bucketMs)), tokens: 0, cost: 0 }));
          const ranges = buckets.map((_, index): [string, string] => {
            const from = startTime + index * bucketMs;
            return [iso(from), iso(index === count - 1 ? nowMs + 1 : Math.min(from + bucketMs, nowMs + 1))];
          });
          for (const group of aggregateUsage(sqlite, scope, { buckets: ranges })) {
            buckets[group.bucket as number].tokens += group.promptTokens + group.completionTokens;
            buckets[group.bucket as number].cost += group.cost;
          }
          return buckets;
        };
        if (normalized === "1h") return timedBuckets(minuteBase(nowMs).getTime(), MINUTE_BUCKETS, MINUTE_BUCKET_MS, minuteLabel);
        if (normalized === "today" || normalized === "24h") {
          const bucketMs = 60 * 60 * 1000;
          const start = normalized === "today" ? new Date() : new Date(nowMs - 24 * bucketMs);
          if (normalized === "today") start.setHours(0, 0, 0, 0);
          return timedBuckets(start.getTime(), 24, bucketMs, (date) => date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));
        }
        let keys: string[];
        if (normalized === "all") keys = daysInScope(scope);
        else {
          const bucketCount = normalized === "7d" ? 7 : normalized === "30d" ? 30 : 60;
          keys = Array.from({ length: bucketCount }, (_, index) => {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - (bucketCount - 1 - index));
            return localDateKey(date.toISOString());
          });
        }
        const label = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString("en-US", normalized === "all" ? { month: "short", day: "numeric", year: "2-digit" } : { month: "short", day: "numeric" });
        const buckets = keys.map((key) => ({ label: label(key), tokens: 0, cost: 0 }));
        const used = new Set<number>();
        for (const group of aggregateUsage(sqlite, scope, { buckets: dayRanges(keys) })) {
          const bucket = buckets[group.bucket as number];
          bucket.tokens += group.promptTokens + group.completionTokens;
          bucket.cost += group.cost;
          used.add(group.bucket as number);
        }
        // "all" lists only the days that have rows.
        return normalized === "all" ? buckets.filter((_, index) => used.has(index)) : buckets;
      },
      providers(period = "all") {
        const rows: Array<Record<string, unknown>> = Object.entries(usageTotalsGrouped(period, ["provider"], providerKey)).map(([provider, usage]) => ({ provider, ...usage }));
        return rows.sort((left, right) => Number(right.requests) - Number(left.requests));
      },
      providerIds() {
        usageReady();
        const counts = new Map<string, number>();
        for (const row of usageProviderCounts(sqlite)) {
          const id = providerKey({ provider: row.provider });
          counts.set(id, (counts.get(id) || 0) + row.requests);
        }
        return [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([id]) => id);
      },
      apiKeys(apiKeys, period = "all") {
        const totals = usageTotalsGrouped(period, ["apiKey"], (keys) => keys.apiKey || "unknown");
        const empty = () => ({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, lastUsed: null });
        return Object.fromEntries(apiKeys.filter((value) => typeof value === "string" && value).map((value) => [value, totals[value] || empty()]));
      },
      statsForProvider(provider, period = "all", recentLimit = 30) {
        return groupedStats(periodScope(period, { provider: provider === "unknown" ? null : provider }), [["byAccount", "connection_id"], ["byApiKey", "api_key_id"]], recentLimit);
      },
      statsForApiKey(apiKey, period = "all", recentLimit = 30) {
        return groupedStats(periodScope(period, { apiKey }), [["byProvider", "provider"]], recentLimit);
      },
      statsForAccount(connectionId, period = "all", recentLimit = 30) {
        return groupedStats(periodScope(period, { connectionId }), [], recentLimit);
      },
      accounts(period = "all") {
        return Object.entries(usageTotalsGrouped(period, ["connectionId"], (keys) => keys.connectionId || "unknown"))
          .map(([id, usage]) => ({ id, usage }))
          .sort((left, right) => Number(right.usage.requests) - Number(left.usage.requests));
      },
      models(period = "all") {
        return Object.entries(usageTotalsGrouped(period, ["provider", "model"], modelKey))
          .map(([id, usage]) => ({ id, usage }))
          .sort((left, right) => Number(right.usage.requests) - Number(left.usage.requests));
      },
      combos(period = "all") {
        return Object.entries(usageTotalsGrouped(period, ["comboName"], (keys) => keys.comboName || ""))
          .filter(([id]) => id !== "unknown")
          .map(([id, usage]) => ({ id, usage }))
          .sort((left, right) => Number(right.usage.requests) - Number(left.usage.requests));
      },
      combosForApiKey(apiKey, period = "all") {
        return usageTotalsGrouped(period, ["comboName"], (keys) => keys.comboName || "", { apiKey });
      },
    },
  };
}
