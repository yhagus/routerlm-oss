import crypto from "crypto";
import { EventEmitter } from "events";
import { getAdapter } from "../driver.ts";
import { parseJson, stringifyJson } from "../helpers/jsonCol.ts";

function maskApiKey(key: any) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

function hashApiKey(key: any) {
  if (!key || typeof key !== "string") return null;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function getApiKeyIdentity(key: any, keyInfo: any) {
  if (!key || typeof key !== "string") return "local-no-key";
  if (keyInfo?.id) return `api-key:${keyInfo.id}`;
  const hash = hashApiKey(key);
  return hash ? `api-key-hash:${hash}` : "unknown-api-key";
}

const PENDING_TIMEOUT_MS = 60 * 1000;

// In-memory state shared across Next.js modules
if (!(globalThis as any)._pendingRequests) (globalThis as any)._pendingRequests = { byModel: {} as Record<string, any>, byAccount: {} };
if (!(globalThis as any)._lastErrorProvider) (globalThis as any)._lastErrorProvider = { provider: "", ts: 0 };
if (!(globalThis as any)._statsEmitter) {
  (globalThis as any)._statsEmitter = new EventEmitter();
  (globalThis as any)._statsEmitter.setMaxListeners(50);
}
if (!(globalThis as any)._pendingTimers) (globalThis as any)._pendingTimers = {};
if (!(globalThis as any)._statsEmitTimers) (globalThis as any)._statsEmitTimers = { pending: null, update: null };

const pendingRequests = (globalThis as any)._pendingRequests;
const lastErrorProvider = (globalThis as any)._lastErrorProvider;
const pendingTimers = (globalThis as any)._pendingTimers;
const statsEmitTimers = (globalThis as any)._statsEmitTimers;

export const statsEmitter = (globalThis as any)._statsEmitter;

function scheduleStatsEvent(event: any, delayMs = 150) {
  const key = event === "update" ? "update" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

function getLocalDateKey(timestamp: any) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tokenNumber(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function firstTokenNumber(...values: any[]) {
  for (const value of values) {
    const n = tokenNumber(value);
    if (n !== 0) return n;
  }
  return 0;
}

function getUsageTokenCounts(tokens: any = {}, fallback: any = {}) {
  const source = tokens || {};
  const cacheCreationTokens = firstTokenNumber(source.cache_creation_input_tokens, source.input_tokens_details?.cache_creation_tokens, source.prompt_tokens_details?.cache_creation_tokens);
  const explicitCachedTokens = Object.prototype.hasOwnProperty.call(source, "cached_tokens");
  const hasOpenAIDetails = !explicitCachedTokens && (
    Object.prototype.hasOwnProperty.call(source, "input_tokens_details") ||
    Object.prototype.hasOwnProperty.call(source, "prompt_tokens_details")
  );
  const cachedTokens = explicitCachedTokens
    ? tokenNumber(source.cached_tokens)
    : firstTokenNumber(source.cache_read_input_tokens, source.input_tokens_details?.cached_tokens, source.prompt_tokens_details?.cached_tokens);
  const basePromptTokens = firstTokenNumber(source.prompt_tokens, source.input_tokens, fallback.promptTokens);
  const promptTokens = explicitCachedTokens || hasOpenAIDetails
    ? basePromptTokens
    : basePromptTokens + cachedTokens + cacheCreationTokens;

  return {
    promptTokens,
    completionTokens: firstTokenNumber(source.completion_tokens, source.output_tokens, fallback.completionTokens),
    cachedTokens,
  };
}

function createEmptyDay() {
  return {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    cost: 0,
    byProvider: {} as Record<string, any>,
    byModel: {} as Record<string, any>,
    byAccount: {} as Record<string, any>,
    byApiKey: {} as Record<string, any>,
    byEndpoint: {} as Record<string, any>,
  };
}

function addToCounter(target: any, key: any, values: any) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day: any, entry: any) {
  const { promptTokens, completionTokens, cachedTokens } = getUsageTokenCounts(entry.tokens, entry);
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = getApiKeyIdentity(entry.apiKey, null);
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, apiKeyMasked: maskApiKey(entry.apiKey), apiKeyKey: apiKeyVal } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

async function calculateCost(provider: any, model: any, tokens: any) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.ts");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    const { calculateCostFromTokens } = await import("../../../billing/providerPricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e: any) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model: any, provider: any, connectionId: any, started: any, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  // [PENDING] console line removed; lifecycle is visible via "▶" and "📊 done" lines
  scheduleStatsEvent("pending");
}

export async function saveRequestUsage(entry: any) {
  try {
    const db = await getAdapter();
    const hasClientIp = ensureUsageHistoryClientIp(db);

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    const tokens = entry.tokens || {};
    const { promptTokens, completionTokens } = getUsageTokenCounts(tokens);
    const clientIp = typeof entry.clientIp === "string" && entry.clientIp.trim()
      ? entry.clientIp.trim()
      : null;

    let inserted = false;

    // All 3 writes (history insert, daily upsert, lifetime counter) in ONE transaction.
    // better-sqlite3 is sync → no JS yield mid-transaction → no race in same process.
    db.transaction(() => {
      const existing = db.get(
        `SELECT id, endpoint, meta FROM usageHistory
         WHERE timestamp = ?
           AND COALESCE(provider, '') = COALESCE(?, '')
           AND COALESCE(model, '') = COALESCE(?, '')
           AND COALESCE(connectionId, '') = COALESCE(?, '')
           AND COALESCE(apiKey, '') = COALESCE(?, '')
           AND promptTokens = ?
           AND completionTokens = ?
         ORDER BY id DESC LIMIT 1`,
        [
          entry.timestamp, entry.provider || null, entry.model || null,
          entry.connectionId || null, entry.apiKey || null,
          promptTokens, completionTokens,
        ]
      );

      if (existing) {
        if (!existing.endpoint && entry.endpoint) {
          db.run(`UPDATE usageHistory SET endpoint = ? WHERE id = ?`, [entry.endpoint, existing.id]);
        }
        if (entry.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta)) {
          const existingMeta = parseJson(existing.meta, {}) || {};
          // A NULL cachedTokens makes the SQL read layer derive the facts again from the new meta.
          db.run(`UPDATE usageHistory SET meta = ?, cachedTokens = NULL WHERE id = ?`, [stringifyJson({ ...existingMeta, ...entry.meta }), existing.id]);
        }
        return;
      }

      if (hasClientIp) {
        db.run(
          `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, clientIp, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.timestamp, entry.provider || null, entry.model || null,
            entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
            clientIp,
            promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
            stringifyJson(tokens), stringifyJson(entry.meta || {}),
          ]
        );
      } else {
        db.run(
          `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.timestamp, entry.provider || null, entry.model || null,
            entry.connectionId || null, entry.apiKey || null, entry.endpoint || null,
            promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
            stringifyJson(tokens), stringifyJson(entry.meta || {}),
          ]
        );
      }

      const dateKey = getLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : createEmptyDay();
      aggregateEntryToDay(day, entry);
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);

      // Lifetime per-key counters for usage limits (O(1) gate checks)
      if (entry.apiKey && typeof entry.apiKey === "string") {
        db.run(
          `UPDATE apiKeys SET usageRequests = COALESCE(usageRequests, 0) + 1, usageTokens = COALESCE(usageTokens, 0) + ? WHERE key = ?`,
          [promptTokens + completionTokens, entry.apiKey]
        );
      }
      inserted = true;
    });

    if (inserted) {
      scheduleStatsEvent("update", 250);
    }
  } catch (e: any) {
    console.error("Failed to save usage stats:", e);
  }
}

function usageHistoryHasClientIp(db: any) {
  try {
    const cols = db.all(`PRAGMA table_info(usageHistory)`);
    return cols.some((c: any) => c.name === "clientIp");
  } catch {
    return false;
  }
}

function ensureUsageHistoryClientIp(db: any) {
  if (usageHistoryHasClientIp(db)) return true;
  try {
    db.exec(`ALTER TABLE usageHistory ADD COLUMN clientIp TEXT`);
    return true;
  } catch {
    return usageHistoryHasClientIp(db);
  }
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}
