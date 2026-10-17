// reasoningReplay/index.js
// Ported from grok2api backend/internal/pkg/reasoningreplay/reasoning_replay.go.
//
// createReasoningReplay({ store, getStore, enabled, ttlMs }) -> service with:
//   - Apply({ model, sessionKey, body })        : inject cached items into request body
//   - StoreFromCompleted({ model, sessionKey, payload }) : cache normalized items
//   - StoreFromCompletedPayload({ ..., compact })      : compact=true -> Clear
//   - Clear({ model, sessionKey })             : drop a cached entry
//   - isEnabled() / updateConfig({ enabled, ttlMs })
//
// The store resolves lazily so importing this module never touches the DB; the SQLite
// makeKv store is wired only on first real use, with an in-memory fallback if the DB
// layer is unavailable.

import { applyReplay } from "./apply.js";
import {
  extractReplayItemsFromPayload,
  normalizeReplayItems,
  previousResponseIDPresent,
} from "./normalize.js";
import { makeReplayStore, makeInMemoryKv } from "./store.js";

export const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_ENTRIES = 10240;

export function createReasoningReplay({
  store = null,
  getStore = null,
  enabled = true,
  ttlMs = DEFAULT_TTL_MS,
} = {} as any) {
  const cfg = { enabled, ttlMs };
  const resolveStore = async () => {
    if (store) return store;
    if (typeof getStore === "function") return await getStore();
    return null;
  };

  return {
    updateConfig(next: any = {}) {
      if (next.enabled !== undefined) cfg.enabled = !!next.enabled;
      if (typeof next.ttlMs === "number" && Number.isFinite(next.ttlMs) && next.ttlMs > 0) {
        cfg.ttlMs = next.ttlMs;
      }
    },
    isEnabled() {
      return !!cfg.enabled;
    },
    // Apply: inject cached reasoning/tool-call/assistant items into body.input.
    // Skipped when disabled, when client uses previous_response_id (server holds state),
    // when scope is missing, or when there is no cached entry.
    async Apply({ model, sessionKey, body } = {} as any) {
      if (!cfg.enabled) return body;
      if (!model || !sessionKey || !body || typeof body !== "object") return body;
      if (previousResponseIDPresent(body)) return body;
      if (!Array.isArray(body.input) || body.input.length === 0) return body;
      const s = await resolveStore();
      if (!s) return body;
      let items;
      try {
        items = await s.get(model, sessionKey);
      } catch {
        return body; // fail-open: never break the request over a cache miss error
      }
      if (!items || items.length === 0) return body;
      const { body: updated } = applyReplay(body, items);
      return updated;
    },
    // StoreFromCompleted: extract + normalize output items from a completed Responses
    // payload, then cache them under (model, sessionKey). Items without an anchor
    // (reasoning/function_call/custom_tool_call) cause the entry to be deleted, matching
    // grok2api's "no_anchor" behavior.
    async StoreFromCompleted({ model, sessionKey, payload } = {} as any) {
      if (!cfg.enabled) return;
      if (!model || !sessionKey) return;
      const s = await resolveStore();
      if (!s) return;
      const { items: raw, complete } = extractReplayItemsFromPayload(payload);
      if (!complete) return;
      const { items, ok } = normalizeReplayItems(raw);
      if (!ok) {
        try {
          await s.delete(model, sessionKey);
        } catch {
          /* fall open */
        }
        return;
      }
      try {
        await s.set(model, sessionKey, items);
      } catch {
        /* fall open */
      }
    },
    // StoreFromCompletedPayload: compact path clears the cache (a successful compact
    // means upstream dropped the prior reasoning state); otherwise store normally.
    async StoreFromCompletedPayload({ model, sessionKey, payload, compact = false } = {} as any) {
      if (compact) return this.Clear({ model, sessionKey });
      return this.StoreFromCompleted({ model, sessionKey, payload });
    },
    async Clear({ model, sessionKey } = {} as any) {
      if (!cfg.enabled || !model || !sessionKey) return;
      const s = await resolveStore();
      if (!s) return;
      try {
        await s.delete(model, sessionKey);
      } catch {
        /* fall open */
      }
    },
  };
}

// --- Default singleton (production wiring) -------------------------------------

let defaultStorePromise: any = null;
let defaultService: any = null;

async function getDefaultStore() {
  if (defaultStorePromise) return defaultStorePromise;
  defaultStorePromise = (async () => {
    let kv;
    try {
      // @/ alias resolves to src/ (same alias used by open-sse/handlers for @/lib/usageDb.js).
      const mod = await import("../../platform/db/helpers/kvStore.ts");
      kv = mod.makeKv("reasoningReplay");
    } catch {
      // DB layer unavailable (e.g. open-sse isolated test run) -> in-memory fallback.
      kv = makeInMemoryKv();
    }
    return makeReplayStore({ kv, maxSize: envMaxEntries(), ttlMs: envTtlMs() });
  })();
  return defaultStorePromise;
}

function envEnabled() {
  const v = process.env.REASONING_REPLAY_ENABLED;
  if (v == null) return true; // on by default
  return v !== "false" && v !== "0";
}
function envTtlMs() {
  return parseTtlMs(process.env.REASONING_REPLAY_TTL, DEFAULT_TTL_MS);
}
function envMaxEntries() {
  const v = Number(process.env.REASONING_REPLAY_MAX_ENTRIES);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_ENTRIES;
}

export function parseTtlMs(raw: any, fallback: any) {
  if (raw == null || raw === "") return fallback;
  const str = String(raw).trim();
  const match = str.match(/^(\d+)\s*(ms|s|m|h)?$/i);
  if (!match) return fallback;
  let n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const unit = (match[2] || "ms").toLowerCase();
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    default:
      return fallback;
  }
}

// getReasoningReplay: returns the process-wide singleton. Store resolves lazily on first
// use so importing this module has no side effects.
export function getReasoningReplay() {
  if (defaultService) return defaultService;
  defaultService = createReasoningReplay({
    getStore: getDefaultStore,
    enabled: envEnabled(),
    ttlMs: envTtlMs(),
  });
  return defaultService;
}
