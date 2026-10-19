// Session affinity: keep one conversation (and one API key) on one Connection.
//
// Upstream prompt caches are per account. A conversation that hops between
// accounts pays the full input price on every hop. Each affinity key gets a
// home Connection:
//   - A home with a free slot serves the request.
//   - A busy home (at its in-flight limit) spills this one request to another
//     Connection. The home stays, so the next request returns to the account
//     that holds the warm cache.
//   - A home that is no longer eligible (locked, failed in this request,
//     inactive or deleted) is replaced by the Connection that serves now.
//
// Two keys per request, tried in order:
//   session: provider + API key + client session id. Most precise cache match.
//   user:    provider + API key. A new conversation of the same user starts on
//            the account that already caches the user's shared system prompt.
//
// Bindings live in memory, like the in-flight counters. A restart starts cold.
import type { ProviderConnection } from "../../db/repositories";

export type AffinityKeys = { session: string | null; user: string | null };

// Idle bindings expire after the longest common upstream cache lifetime.
const AFFINITY_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_AFFINITY_ENTRIES = 20_000;

const homes = new Map<string, { connectionId: string; lastUsed: number }>();

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of homes) {
    if (now - entry.lastUsed > AFFINITY_TTL_MS) homes.delete(key);
  }
}, 10 * 60 * 1000);
if (cleanup.unref) cleanup.unref();

// providerStrategies[provider].sessionAffinity wins over the global
// sessionAffinity setting. Only an explicit false turns it off.
export function affinityEnabled(settings: Record<string, any>, provider: string): boolean {
  const own = settings.providerStrategies?.[provider]?.sessionAffinity;
  if (typeof own === "boolean") return own;
  return settings.sessionAffinity !== false;
}

// Affinity keys for one request. Returns null when the request carries no
// identity at all, so it cannot pin anything.
export function affinityKeysFor(provider: string, apiKeyId: string | null, sessionId: string | null): AffinityKeys | null {
  if (!apiKeyId && !sessionId) return null;
  const user = apiKeyId ? `${provider}|${apiKeyId}` : null;
  const session = sessionId ? `${provider}|${apiKeyId || ""}|${sessionId}` : null;
  return { session, user };
}

export function homeConnectionId(key: string | null): string | null {
  if (!key) return null;
  const entry = homes.get(key);
  if (!entry) return null;
  if (Date.now() - entry.lastUsed > AFFINITY_TTL_MS) {
    homes.delete(key);
    return null;
  }
  return entry.connectionId;
}

export function bindAffinity(key: string | null, connectionId: string): void {
  if (!key) return;
  homes.delete(key);
  if (homes.size >= MAX_AFFINITY_ENTRIES) homes.delete(homes.keys().next().value!);
  homes.set(key, { connectionId, lastUsed: Date.now() });
}

// The home Connection with a free slot, session key first. Null when no key
// has a free home: the caller then picks by the provider strategy.
export function freeHome(keys: AffinityKeys, free: ProviderConnection[]): ProviderConnection | null {
  for (const key of [keys.session, keys.user]) {
    const id = homeConnectionId(key);
    const home = id ? free.find((connection) => connection.id === id) : undefined;
    if (home) return home;
  }
  return null;
}

// Record the serving Connection as home for each key whose current home is
// missing or not eligible. A home that is only busy keeps its binding.
export function rememberHome(keys: AffinityKeys, eligibleIds: Set<string>, chosenId: string): void {
  for (const key of [keys.session, keys.user]) {
    const id = homeConnectionId(key);
    if (id && eligibleIds.has(id)) {
      if (id === chosenId) bindAffinity(key, id);
      continue;
    }
    bindAffinity(key, chosenId);
  }
}

export function clearAffinity(): void {
  homes.clear();
}
