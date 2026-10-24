export interface AuthStatus {
  requireLogin: boolean;
  authenticated: boolean;
  authMode?: string;
  oidcConfigured?: boolean;
  oidcLoginLabel?: string | null;
  hasPassword?: boolean;
  displayName?: string;
  loginMethod?: "OIDC" | "Password";
  oidcName?: string | null;
  oidcEmail?: string | null;
  oidcLogin?: boolean;
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
  displayName?: string | null;
  globalPriority?: number | null;
  defaultModel?: string | null;
  group?: string | null;
  testStatus?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  errorCode?: string | null;
  probe407DamagedAt?: string | null;
  expiresAt?: string | null;
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

/** Aggregated quota across every active connection of a provider. */
export interface ProviderQuotaSummary {
  kind: "balance" | "percentage" | null;
  totalBalance: number | null;
  unit: string | null;
  balancesByUnit?: Array<{ unit: string; balance: number }>;
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

export type ConnectionTestJobStatus =
  "queued" | "running" | "completed" | "cancelled" | "failed";

export type ConnectionTestItemStatus =
  "queued" | "testing" | "success" | "failed" | "cancelled";

export interface ConnectionTestJobItem {
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

export interface ConnectionTestJob {
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
  items: ConnectionTestJobItem[];
}

export type Probe407Status =
  "queued" | "probing" | "healthy" | "damaged" | "error";

export interface Probe407Item {
  connectionId: string;
  name: string | null;
  email: string | null;
  status: Probe407Status;
  reply: string | null;
  error: string | null;
}

export interface Probe407Result {
  provider: string;
  total: number;
  completed: number;
  healthy: number;
  damaged: number;
  errors: number;
  items: Probe407Item[];
}

export interface Probe407Job {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Probe407Result | null;
  error: string | null;
}

export interface ProviderModelTestResult {
  modelId: string;
  name?: string;
  ok: boolean;
  error?: string | null;
  [key: string]: unknown;
}

export interface ProviderNode {
  id: string;
  type: string | null;
  name: string | null;
  prefix: string | null;
  api_type?: string | null;
  base_url?: string | null;
  apiType?: string | null;
  baseUrl?: string | null;
  data: string | Record<string, unknown>;
}

export interface ProxyPool {
  id: string;
  name: string;
  proxy_url?: string;
  proxyUrl?: string;
  noProxy?: string;
  is_active?: number;
  isActive?: boolean;
  testStatus?: string;
  lastTestedAt?: string;
  lastError?: string | null;
  data: string | Record<string, unknown>;
}

export interface ModelItem {
  id: string;
  name?: string;
  object?: string;
  owned_by?: string;
  provider?: string | null;
  model?: string;
  kind?: string;
  disabled?: number;
  context_window?: number | null;
}

export interface Combo {
  id: string;
  name: string;
  kind: string | null;
  models: string[] | string;
  identity_enabled?: number;
  account_filters?: string | Record<string, unknown>;
  identityEnabled?: boolean | number;
  accountFilters?: string | Record<string, unknown>;
  use_custom_account_order?: number;
  useCustomAccountOrder?: boolean | number;
  capabilities?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface VisionAdapter {
  id: string;
  name: string;
  models: string[];
  isGlobal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  key?: string;
  keyPrefix?: string | null;
  machineId?: string | null;
  name: string | null;
  isActive: boolean;
  visibility: string;
  isDefault: boolean;
  usageRequests: number;
  usageTokens: number;
  limitMode: string;
  limitValue: number | null;
  maxConcurrency?: number | null;
  parentId?: string | null;
  childCount?: number;
  connectionPins?: Record<string, Record<string, string[]>>;
  comboAccessMode?: "blacklist" | "whitelist" | string;
  comboAccessList?: string[];
  modelAccessMode?: "blacklist" | "whitelist" | string;
  modelAccessList?: string[];
  features?: Record<string, unknown>;
  usage?: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastUsed?: string | null;
  };
  createdAt?: string;
}

export interface PublicEvent {
  id: string;
  name: string | null;
  participants: number;
}

export interface ApiKeyPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiKeysResponse {
  keys: ApiKey[];
  pagination: ApiKeyPagination;
}

export interface UsageSummary {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  cached_tokens: number;
}

export interface UsageRecord {
  id: string;
  timestamp: string;
  provider: string | null;
  model: string | null;
  displayModel?: string | null;
  connection_id: string | null;
  endpoint: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  status: string | null;
  tokens?: Record<string, unknown>;
  comboName?: string | null;
  clientIp?: string | null;
  latency?: { ttft?: number; total?: number; tokensPerSecond?: number } | null;
  request?: unknown;
  requestHeaders?: Record<string, unknown> | null;
  providerRequest?: unknown;
  providerResponse?: unknown;
  responseHeaders?: Record<string, unknown> | null;
  response?: {
    content?: unknown;
    thinking?: string;
    [key: string]: unknown;
  } | null;
  pxpipe?: Record<string, unknown> | null;
}

export interface UsagePagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

// Usage history page. Pass nextCursor back as `cursor` to read older rows.
// nextCursor is null on the last page.
export interface UsageHistoryPage {
  items: UsageRecord[];
  nextCursor: string | null;
}

export interface RequestDetailsResponse {
  details: UsageRecord[];
  pagination: UsagePagination;
}

export type UsagePeriod = "today" | "1h" | "24h" | "7d" | "30d" | "60d" | "all";

export interface UsageAggregate {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  failed?: number;
  lastUsed?: string | null;
}

export type UsageTrendBy =
  "provider" | "account" | "model" | "combo" | "apiKey";

export interface UsageTrend {
  period: UsagePeriod;
  labels: string[];
  series: Array<{ id: string; tokens: number[]; requests: number[] }>;
  names?: Record<string, string>;
}

export interface UsageOverviewTotals {
  requests: number;
  tokens: number;
  cost: number;
  successRate: number | null;
}

export interface UsageOverview {
  period: UsagePeriod;
  totals: UsageOverviewTotals & { failed: number };
  previous: UsageOverviewTotals | null;
  labels: string[];
  buckets: Array<{
    requests: number;
    failed: number;
    tokens: number;
    cost: number;
  }>;
  peak: { label: string; requests: number } | null;
  costByProvider: Array<{
    id: string;
    name: string;
    cost: number;
    requests: number;
  }>;
  models: Array<{
    id: string;
    name: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    failed: number;
  }>;
}

export type UsageActivity = "all" | "used" | "unused";
export type UsageHealth = "all" | "failing" | "healthy";
export type UsageSort = "requests" | "tokens" | "cost" | "recent" | "name";

export interface UsageProviderRow {
  id: string;
  name: string;
  usage: UsageAggregate;
}

export interface UsageKeyRow {
  id: string;
  name: string | null;
  key: string;
  isActive: boolean;
  visibility?: string;
  usage: UsageAggregate;
}

export interface UsageEntityRow {
  id: string;
  name: string;
  usage: UsageAggregate;
}

export interface UsageListResponse<T> {
  providers?: T[];
  keys?: T[];
  items?: T[];
  pagination: UsagePagination;
}

export interface DashboardUsage {
  buckets?: Array<{
    label: string;
    requests?: number;
    tokens?: number;
    cost?: number;
  }>;
  totals?: { requests?: number; tokens?: number; cost?: number };
  topProvider?: { name?: string; requests?: number } | null;
  topModel?: { name?: string; requests?: number } | null;
}


export interface ModelListResponse {
  object: "list";
  data: ModelItem[];
}

export interface Capability {
  id?: string;
  supported?: boolean;
  available?: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface NormalizedQuota {
  id: string;
  name: string;
  used: number | null;
  total: number | null;
  remaining: number | null;
  resetAt: string | null;
  unlimited: boolean;
}

export interface QuotaAccount {
  id: string;
  provider: string;
  name: string;
  email: string | null;
  isActive: boolean;
  authType: string;
  quotas: NormalizedQuota[];
  plan: string | null;
  message: string | null;
  error: string | null;
  fetchedAt: string | null;
}

export interface QuotaProvider {
  provider: string;
  connections: QuotaAccount[];
}

export interface QuotaResponse {
  providers: QuotaProvider[];
}

export interface FreeTrackerModel {
  id: string;
  poolId: string;
  poolName: string;
  poolPrefix: string;
  kind: "shared" | "open";
  usedPercent: number | null;
  remainingPercent: number | null;
}

export interface FreeTrackerSource {
  id: string;
  name: string;
  icon: string;
  sourceUrl: string;
  note: string;
  models: FreeTrackerModel[];
  publicVisible: boolean;
}

export interface FreeTrackerResponse {
  sources: FreeTrackerSource[];
  fetchedAt: string;
  cached: boolean;
  pools?: Array<Record<string, unknown>>;
  source?: string;
  sourceUrl?: string;
  partialErrors?: string[];
}

export type QueueJobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export interface QueueJob {
  jobId: string;
  source: string;
  status: QueueJobStatus;
  stage: string | null;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ownerId?: string;
  detail?: Record<string, unknown>;
}

export interface QueueJobsResponse {
  jobs: QueueJob[];
}

export type PricingEntry = Partial<
  Record<"input" | "output" | "cached" | "reasoning" | "cache_creation", number>
>;
export type PricingMap = Record<string, Record<string, PricingEntry>>;

export interface CliToolCatalogItem {
  id: string;
  status: Record<string, unknown>;
}

export interface CliToolCatalogResponse {
  data: CliToolCatalogItem[];
}

export interface ConsoleLogsResponse {
  success: boolean;
  logs: string[];
}

export interface PublicKeyStats {
  key: {
    name: string | null;
    keyPrefix: string;
    createdAt: string;
    limitMode: "none" | "requests" | "tokens";
    limitValue: number | null;
    usageRequests: number;
    usageTokens: number;
    modelAccessMode: "whitelist" | "blacklist";
    modelAccessList: string[];
  };
  totals: {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    cost: number;
    lastUsed: string | null;
  };
  combos: Array<{
    name: string;
    kind: string | null;
    contextWindow: number | null;
    maxOutput: number | null;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    totalTokens: number;
    lastUsed: string | null;
    errorRate: number;
    avgTokensPerSecond: number;
    avgLatencyMs: number;
  }>;
  activeRequests: number;
  // Tokens per day for the last 7 days, split by combo or bare model. Only this key's traffic.
  activity?: UsageTrend;
  codebuddyTracker: {
    label: string;
    used: number;
    total: number;
    remaining: number;
  } | null;
  endpoints: Array<{
    id: string;
    name: string;
    method: string;
    path: string;
    stream: boolean;
  }>;
  // Combo name, or the model id without its provider prefix.
  recentRequests: Array<{
    timestamp: string;
    model: string;
    isCombo: boolean;
    tokensPerSecond: number | null;
    latencyMs: number | null;
    success: boolean;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    clientIp: string | null;
  }>;
  byIp?: Array<{
    ip: string;
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    lastUsed: string;
  }>;
  updatedAt: string;
}
