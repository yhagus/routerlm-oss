import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { publicModelName, type ApiKeyRecord } from "../db/repositories";

// Proxies forward a comma-separated chain ("client, proxy, ..."); mask every hop.
export function maskIp(value: string): string {
  if (!value) return "";
  return value.split(",").map((part) => maskSingleIp(part.trim())).filter(Boolean).join(", ");
}

// Keep the first and last segment so rows stay distinguishable. Unrecognized
// values are hidden instead of shown raw.
function maskSingleIp(ip: string): string {
  if (!ip) return "";
  const v4 = ip.match(/^(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})(:\d+)?$/);
  if (v4) return `${v4[1]}.*.*.${v4[2]}${v4[3] || ""}`;
  const bracketed = ip.match(/^\[([^\]]+)\](:\d+)?$/);
  const host = bracketed ? bracketed[1] : ip;
  const port = bracketed?.[2] || "";
  if (/^[0-9a-f:.]+$/i.test(host) && host.includes(":")) {
    const mapped = host.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    const masked = mapped
      ? `${mapped[1]}${maskSingleIp(mapped[2])}`
      : `${host.split(":").find(Boolean) || ""}:*:*:${host.split(":").pop() || ""}`;
    return port ? `[${masked}]${port}` : masked;
  }
  return "*";
}

// Masking can map several raw IPs to one label, so merge rows after masking.
function maskedIpUsage(rows: Array<Record<string, any>>) {
  const merged = new Map<string, { ip: string; requests: number; promptTokens: number; completionTokens: number; totalTokens: number; lastUsed: string }>();
  for (const row of rows) {
    const ip = maskIp(String(row.ip || ""));
    const promptTokens = Number(row.promptTokens) || 0;
    const completionTokens = Number(row.completionTokens) || 0;
    const entry = merged.get(ip) || { ip, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, lastUsed: String(row.lastUsed || "") };
    entry.requests += Number(row.requests) || 0;
    entry.promptTokens += promptTokens;
    entry.completionTokens += completionTokens;
    entry.totalTokens += promptTokens + completionTokens;
    if (String(row.lastUsed || "") > entry.lastUsed) entry.lastUsed = String(row.lastUsed);
    merged.set(ip, entry);
  }
  return [...merged.values()];
}

// Allow-list the request log fields. Provider, connection, and raw upstream model stay private.
function publicRequest(row: Record<string, any>) {
  return {
    timestamp: row.timestamp,
    model: publicModelName(row.comboName, row.model),
    isCombo: Boolean(row.comboName),
    success: row.success !== false,
    tokensPerSecond: row.tokensPerSecond ?? null,
    latencyMs: row.latencyMs ?? null,
    promptTokens: Number(row.promptTokens) || 0,
    completionTokens: Number(row.completionTokens) || 0,
    cachedTokens: Number(row.cachedTokens) || 0,
    clientIp: row.clientIp ? maskIp(String(row.clientIp)) : null,
  };
}

// In-memory TTL cache for the full stats response. Keyed by API key string.
// Avoids recomputing usage stats + quota sums on every 5s poll from the
// public status page. A 20s TTL means at most 1 in 4 polls does real work.
const statsCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
const STATS_CACHE_TTL_MS = 20_000;

function cachedStats(key: string): Record<string, unknown> | null {
  const hit = statsCache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    statsCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCachedStats(key: string, data: Record<string, unknown>): void {
  statsCache.set(key, { data, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
}

// Public per-key status data for the root status page. Possession of the key
// is the access control, matching the /api/connect discovery route.
function canUseCombo(key: ApiKeyRecord, comboName: string): boolean {
  const mode = key.comboAccessMode || "blacklist";
  const listed = key.comboAccessList.includes(comboName);
  return mode === "whitelist" ? listed : !listed;
}

// Every chat transport accepts `stream: true` and answers with SSE.
const CHAT_ENDPOINTS = [
  { id: "chat", name: "OpenAI Chat Completions", method: "POST", path: "/v1/chat/completions", stream: true },
  { id: "responses", name: "OpenAI Responses", method: "POST", path: "/v1/responses", stream: true },
  { id: "anthropic-messages", name: "Anthropic Messages", method: "POST", path: "/v1/messages", stream: true },
];

const emptyUsage = () => ({ requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, lastUsed: null });

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function comboCapabilities(combo: Record<string, unknown>): Record<string, unknown> {
  try { return JSON.parse(String(combo.capabilities || "{}")) as Record<string, unknown>; } catch { return {}; }
}

// Sum all active connections' quota packages for a provider into one { used, total }.
// Triggers a background quota refresh if the snapshot is stale or missing.
function totalProviderQuota(runtime: Runtime, provider: string): { used: number; total: number; remaining: number } | null {
  const connections = runtime.repos.providers.select(provider).filter((c) => c.isActive);
  if (!connections.length) return null;
  let used = 0;
  let total = 0;
  let found = false;
  for (const conn of connections) {
    const payload = runtime.quotaSnapshots.getPayload(conn.id);
    const quotas = payload?.quotas as Record<string, { used?: number; total?: number }> | undefined;
    if (!quotas || typeof quotas !== "object" || Object.keys(quotas).length === 0) {
      continue;
    }
    found = true;
    for (const quota of Object.values(quotas)) {
      used += Number(quota?.used) || 0;
      total += Number(quota?.total) || 0;
    }
  }
  // Trigger a background refresh for connections with no cached quota data
  // so the next poll cycle picks it up. The current response may still return
  // null if no snapshot exists yet — the page auto-refreshes every 5s.
  for (const conn of connections) {
    const snapshot = runtime.quotaSnapshots.getSnapshot(conn.id);
    const payload = snapshot ? runtime.quotaSnapshots.getPayload(conn.id) : null;
    const hasQuotas = payload?.quotas && typeof payload.quotas === "object" && Object.keys(payload.quotas as Record<string, unknown>).length > 0;
    if (!snapshot || !hasQuotas) {
      void runtime.quotaSnapshots.requestRefresh(conn.id);
    }
  }
  if (!found) return null;
  return { used, total, remaining: Math.max(0, total - used) };
}

export function publicStatsRoutes(runtime: Runtime) {
  return new Hono().get("/stats", (c) => {
    const value = (c.req.query("apikey") || c.req.query("key") || "").trim();
    if (!value) return c.json({ error: "Missing apikey query parameter" }, 400);
    const record = runtime.repos.keys.getByKey(value);
    if (!record) return c.json({ error: "API key not found or inactive" }, 404);

    // Serve from cache when fresh — skips all SQL, quota snapshot reads,
    // and provider API triggers. Response is identical to a fresh compute.
    const cached = cachedStats(record.key);
    if (cached) return c.json(cached, 200, { "Cache-Control": "no-store" });

    const stats = runtime.repos.usage.statsForApiKey(record.key, "all", 20) as Record<string, any>;
    const comboUsage = runtime.repos.usage.combosForApiKey(record.key, "all");
    const combos = runtime.repos.combos
      .list()
      .filter((combo) => canUseCombo(record, String(combo.name)))
      .map((combo) => {
        const row = combo as Record<string, unknown>;
        const usage = comboUsage[String(combo.name)] || emptyUsage();
        const capabilities = comboCapabilities(row);
        const requests = Number(usage.requests) || 0;
        const failed = Number((usage as Record<string, unknown>).failed) || 0;
        const tpsSum = Number((usage as Record<string, unknown>).tpsSum) || 0;
        const tpsCount = Number((usage as Record<string, unknown>).tpsCount) || 0;
        const latencyMsSum = Number((usage as Record<string, unknown>).latencyMsSum) || 0;
        const latencyCount = Number((usage as Record<string, unknown>).latencyCount) || 0;
        return {
          name: String(combo.name),
          kind: combo.kind || null,
          contextWindow: positiveInt(capabilities.contextWindow),
          maxOutput: positiveInt(capabilities.maxOutput),
          requests,
          promptTokens: Number(usage.promptTokens) || 0,
          completionTokens: Number(usage.completionTokens) || 0,
          cachedTokens: Number(usage.cachedTokens) || 0,
          totalTokens: Number(usage.totalTokens) || 0,
          lastUsed: (usage.lastUsed as string | null) || null,
          errorRate: requests > 0 ? failed / requests : 0,
          avgTokensPerSecond: tpsCount > 0 ? tpsSum / tpsCount : 0,
          avgLatencyMs: latencyCount > 0 ? latencyMsSum / latencyCount : 0,
        };
      })
      .sort((left, right) => right.requests - left.requests);

    // Quota tracker: if the API key has a quotaTracker feature enabled,
    // sum all active connections' quotas for the tracked provider.
    let codebuddyTracker: { label: string; used: number; total: number; remaining: number } | null = null;
    const features = typeof record.features === "object" && record.features ? record.features : {};
    const tracker = (features as Record<string, any>).quotaTracker;
    if (tracker && typeof tracker.provider === "string" && tracker.enabled !== false) {
      const quota = totalProviderQuota(runtime, tracker.provider);
      if (quota) {
        codebuddyTracker = {
          label: typeof tracker.label === "string" && tracker.label.trim() ? tracker.label.trim() : "CodeBuddy CLI",
          used: quota.used,
          total: quota.total,
          remaining: quota.remaining,
        };
      }
    }

    const responseBody = {
      key: {
        name: record.name,
        keyPrefix: record.keyPrefix,
        createdAt: record.createdAt,
        limitMode: record.limitMode || "none",
        limitValue: record.limitValue ?? null,
        usageRequests: record.usageRequests || 0,
        usageTokens: record.usageTokens || 0,
        modelAccessMode: record.modelAccessMode || "whitelist",
        modelAccessList: record.modelAccessList || [],
      },
      totals: {
        requests: Number(stats.totalRequests) || 0,
        promptTokens: Number(stats.totalPromptTokens) || 0,
        completionTokens: Number(stats.totalCompletionTokens) || 0,
        totalTokens: Number(stats.totalTokens) || 0,
        cachedTokens: Number(stats.totalCachedTokens) || 0,
        cost: Number(stats.totalCost) || 0,
        lastUsed: stats.lastUsed || null,
      },
      combos,
      // Tokens per day for the last week, split by combo or bare model. Scoped to this key only.
      activity: runtime.repos.usage.trend("publicModel", "7d", 5, record.key),
      codebuddyTracker,
      activeRequests: runtime.repos.usage.pendingKeySnapshot().get(record.key) || 0,
      endpoints: CHAT_ENDPOINTS,
      recentRequests: (stats.recentRequests || []).map(publicRequest),
      byIp: maskedIpUsage(stats.byIp || []),
      updatedAt: new Date().toISOString(),
    };
    setCachedStats(record.key, responseBody);
    return c.json(responseBody, 200, { "Cache-Control": "no-store" });
  });
}
