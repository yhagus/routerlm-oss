// reasoningReplay/store.js
// Ported from grok2api infra/runtime/memory/reasoning_replay.go, layered over the
// existing SQLite-backed makeKv("reasoningReplay") KV store (src/lib/db/helpers/kvStore.js).
//
// Adds in-app TTL (sliding renewal on hit) + LRU batch eviction over the KV layer,
// matching grok2api's memory store semantics. Single-node — sufficient for the fork.
//
// Entry shape in KV: { items: [...], expiresAt: number, storedAt: number }
// KV key: `${model}:${sessionKey}` (sessionKey is a sha256 hex digest -> no collisions).

const DEFAULT_MAX_SIZE = 10240;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function evictBatchSize(maxSize: any) {
  let n = Math.floor(maxSize / 80);
  if (n < 1) n = 1;
  if (n > 128) n = 128;
  return n;
}

// makeReplayStore: factory. `kv` is a makeKv-style store (get/set/remove/getAll/clear).
// In tests, pass an in-memory fake; in production, pass makeKv("reasoningReplay").
export function makeReplayStore({ kv, maxSize = DEFAULT_MAX_SIZE, ttlMs = DEFAULT_TTL_MS } = {} as any) {
  if (!kv || typeof kv.get !== "function") {
    throw new Error("makeReplayStore: a kv store (get/set/remove/getAll) is required");
  }

  function compositeKey(model: any, sessionKey: any) {
    return `${model}:${sessionKey}`;
  }

  async function get(model: any, sessionKey: any) {
    if (!model || !sessionKey) return null;
    const key = compositeKey(model, sessionKey);
    const entry = await kv.get(key);
    if (!entry || typeof entry !== "object") return null;
    const now = Date.now();
    if (entry.expiresAt <= now) {
      try {
        await kv.remove(key);
      } catch {
        /* fall open */
      }
      return null;
    }
    // Sliding TTL: refresh expiry on hit (matches grok2api ttlSlide semantics).
    const renewed = { ...entry, expiresAt: now + ttlMs, storedAt: now };
    try {
      await kv.set(key, renewed);
    } catch {
      /* fall open — read still valid for this call */
    }
    return cloneItems(renewed.items);
  }

  async function set(model: any, sessionKey: any, items: any) {
    if (!model || !sessionKey || !Array.isArray(items) || items.length === 0) return;
    const key = compositeKey(model, sessionKey);
    const now = Date.now();
    const entry = { items: cloneItems(items), expiresAt: now + ttlMs, storedAt: now };
    // Only run eviction when inserting a brand-new key (grok2api does the same).
    const existing = await kv.get(key);
    if (!existing) {
      await evictIfFull(now);
    }
    await kv.set(key, entry);
  }

  async function remove(model: any, sessionKey: any) {
    if (!model || !sessionKey) return;
    try {
      await kv.remove(compositeKey(model, sessionKey));
    } catch {
      /* fall open */
    }
  }

  async function evictIfFull(now: any) {
    // getAll is O(n) over the scope; acceptable for single-node parity and only runs
    // on new-key inserts.
    let all;
    try {
      all = await kv.getAll();
    } catch {
      return;
    }
    if (!all || typeof all !== "object") return;
    const keys = Object.keys(all);
    // 1) Sweep expired entries first.
    const expiredKeys: any[] = [];
    for (const k of keys) {
      const entry = all[k];
      if (entry && typeof entry === "object" && entry.expiresAt <= now) {
        expiredKeys.push(k);
      }
    }
    for (const k of expiredKeys) {
      try {
        await kv.remove(k);
      } catch {
        /* fall open */
      }
    }
    // 2) If still at/over capacity, evict the oldest batch (LRU by storedAt).
    const remaining = keys.filter((k) => !expiredKeys.includes(k));
    if (remaining.length < maxSize) return;
    const ranked = remaining
      .map((k) => ({ key: k, storedAt: (all[k] && all[k].storedAt) || 0 }))
      .sort((a, b) => a.storedAt - b.storedAt);
    const batch = evictBatchSize(maxSize);
    for (let i = 0; i < Math.min(batch, ranked.length); i++) {
      try {
        await kv.remove(ranked[i].key);
      } catch {
        /* fall open */
      }
    }
  }

  return { get, set, delete: remove, evictIfFull };
}

function cloneItems(items: any) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return JSON.parse(JSON.stringify(items));
}

// In-memory KV fake for tests / fallback when the SQLite layer is unavailable.
export function makeInMemoryKv() {
  const map = new Map();
  return {
    async get(key: any) {
      return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null;
    },
    async getAll() {
      const out: Record<string, any> = {};
      for (const [k, v] of map.entries()) out[k] = JSON.parse(JSON.stringify(v));
      return out;
    },
    async set(key: any, value: any) {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key: any) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    },
  };
}
