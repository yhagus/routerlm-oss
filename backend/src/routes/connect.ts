import { Hono } from "hono";
import type { Runtime } from "../runtime";
import type { ApiKeyRecord } from "../db/repositories";
import { resolveProviderId } from "../services/providers/providerCatalog";

// Public local discovery: tells CLI clients which default public key and combos
// they may use without any dashboard session.
function canUseCombo(key: ApiKeyRecord, comboName: string): boolean {
  const mode = key.comboAccessMode || "blacklist";
  const listed = key.comboAccessList.includes(comboName);
  return mode === "whitelist" ? listed : !listed;
}

function parseModelEntry(entry: string): { prefix: string; model: string } {
  const index = entry.indexOf("/");
  if (index < 0) return { prefix: entry, model: "" };
  return { prefix: entry.slice(0, index), model: entry.slice(index + 1) };
}

function comboModels(combo: Record<string, unknown>): string[] {
  try { return JSON.parse(String(combo.models || "[]")); } catch { return []; }
}

function resolveCanonicalMember(entry: string, nodes: Array<Record<string, unknown>>, aliases: Record<string, string>): string | null {
  let current = entry;
  for (let hops = 0; hops < 10 && aliases[current]; hops += 1) current = aliases[current];
  const { prefix, model } = parseModelEntry(current);
  if (!prefix || !model) return null;
  const node = nodes.find((item) => item.prefix === prefix);
  const provider = String(node ? node.id : resolveProviderId(prefix)).trim().toLowerCase();
  return `${provider}/${model.trim().toLowerCase()}`;
}

function canonicalModel(provider: unknown, model: unknown): string | null {
  const providerId = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  const modelId = typeof model === "string" ? model.trim().toLowerCase() : "";
  return providerId && modelId ? `${providerId}/${modelId}` : null;
}

function aggregateModelUsage(stats: Record<string, unknown>, modelDefinitions: Array<{ name: string; members: string[] }>) {
  const usageByModel = new Map<string, { inputTokens: number; outputTokens: number }>();
  for (const row of (stats.byModel as Array<Record<string, unknown>>) || []) {
    const key = canonicalModel(row?.provider, row?.rawModel);
    if (key) usageByModel.set(key, {
      inputTokens: Number(row?.promptTokens) || 0,
      outputTokens: Number(row?.completionTokens) || 0,
    });
  }

  return modelDefinitions.map(({ name, members }) => {
    const seen = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    for (const member of members) {
      const key = typeof member === "string" ? member.toLowerCase() : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const usage = usageByModel.get(key);
      if (!usage) continue;
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
    }
    return { model: name, inputTokens, outputTokens };
  }).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
}

const CACHE_TTL_MS = 60_000;
const cache: { data: Record<string, unknown> | null; expiresAt: number; refreshPromise: Promise<Record<string, unknown>> | null } = { data: null, expiresAt: 0, refreshPromise: null };

function jsonData(data: Record<string, unknown>, cacheStatus: string) {
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      "X-Connect-Usage-Cache": cacheStatus,
    },
  });
}

function refreshCache(runtime: Runtime): Promise<Record<string, unknown>> {
  if (cache.refreshPromise) return cache.refreshPromise;
  cache.refreshPromise = (async () => {
    const entry = runtime.repos.keys.getDefaultPublicKey();
    const combos = entry ? runtime.repos.combos.list().filter((combo) => canUseCombo(entry.record, String(combo.name))) : [];
    let stats: Record<string, unknown> = {};
    const modelDefinitions: Array<{ name: string; members: string[] }> = [];
    if (entry) {
      stats = runtime.repos.usage.statsForApiKey(entry.record.key, "all", 0) as Record<string, unknown>;
      const nodes = runtime.repos.nodes.list();
      const aliases = runtime.repos.aliases.list();
      for (const combo of combos) {
        modelDefinitions.push({
          name: String(combo.name),
          members: comboModels(combo).map((model) => resolveCanonicalMember(model, nodes, aliases)).filter((member): member is string => Boolean(member)),
        });
      }
    }
    const data = { models: aggregateModelUsage(stats, modelDefinitions), updatedAt: new Date().toISOString() };
    cache.data = data;
    cache.expiresAt = Date.now() + CACHE_TTL_MS;
    return data;
  })().finally(() => {
    cache.refreshPromise = null;
  });
  return cache.refreshPromise;
}

export function connectRoutes(runtime: Runtime) {
  return new Hono()
    .get("/", (c) => {
      try {
        const entry = runtime.repos.keys.getDefaultPublicKey();
        const keys = entry
          ? [{
              id: entry.record.id,
              name: entry.record.name,
              key: entry.key,
              limitMode: entry.record.limitMode || "none",
              limitValue: entry.record.limitValue ?? null,
              usageRequests: entry.record.usageRequests || 0,
              usageTokens: entry.record.usageTokens || 0,
            }]
          : [];
        const combos = entry
          ? runtime.repos.combos.list()
              .filter((combo) => canUseCombo(entry.record, String(combo.name)))
              .map((combo) => ({ name: String(combo.name), kind: combo.kind || null }))
          : [];
        return c.json({ basePath: "/v1", keys, combos });
      } catch {
        return c.json({ error: "Failed to fetch connect info" }, 500);
      }
    })
    .get("/usage", async (c) => {
      const nowMs = Date.now();
      if (cache.data && cache.expiresAt > nowMs) return jsonData(cache.data, "hit");
      // Serve stale data immediately while one request refreshes the shared cache.
      if (cache.data) {
        refreshCache(runtime).catch(() => { /* stale payload stays served */ });
        return jsonData(cache.data, "stale");
      }
      try {
        return jsonData(await refreshCache(runtime), "miss");
      } catch {
        return c.json({ error: "Failed to fetch connect usage" }, 500, { "Cache-Control": "no-store" });
      }
    });
}
