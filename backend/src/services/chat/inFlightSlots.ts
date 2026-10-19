// In-flight slots: per Connection, per API key, and global.
//
// This module is the one in-flight counter. Admission control
// (admission.ts) takes the global and API key slots per request.
// acquireConnectionSlot is the one place a chat attempt marks a Connection as
// busy, and ConnectionSlot.release is the one place it returns. Selection
// reads connectionInFlight to skip a Connection at its limit.
//
// The slot also drives the dashboard pending-request tracking
// (repos.usage.pendingStart/pendingEnd). The count here is kept separately
// because that tracking drops an entry after 60s, so a long stream would stop
// counting against the limit while it is still open.
import type { Runtime } from "../../runtime";

// Retry-After seconds on every busy response: a full API key or global cap
// (admission) and a request whose eligible Connections are all full.
export const BUSY_RETRY_AFTER_SECONDS = 1;

export type ConnectionSlot = {
  // Idempotent: only the first call returns the slot.
  release(): void;
};

// One counter map per slot scope. Keyed by the Repositories object so the
// legacy gateway (created before the Runtime) shares the counts.
export type SlotScope = "connection" | "apiKey" | "global";
export type SlotOwner = Pick<Runtime, "repos">;

const inFlightByOwner = new WeakMap<object, Record<SlotScope, Map<string, number>>>();

function counts(owner: SlotOwner, scope: SlotScope): Map<string, number> {
  let maps = inFlightByOwner.get(owner.repos);
  if (!maps) {
    maps = { connection: new Map(), apiKey: new Map(), global: new Map() };
    inFlightByOwner.set(owner.repos, maps);
  }
  return maps[scope];
}

export function slotsInFlight(owner: SlotOwner, scope: SlotScope, id: string): number {
  return counts(owner, scope).get(id) || 0;
}

// Synchronous count increment. The returned release is idempotent: only the
// first call returns the slot.
export function takeSlot(owner: SlotOwner, scope: SlotScope, id: string): () => void {
  const map = counts(owner, scope);
  map.set(id, (map.get(id) || 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const next = (map.get(id) || 1) - 1;
    if (next > 0) map.set(id, next);
    else map.delete(id);
  };
}

export function connectionInFlight(owner: SlotOwner, connectionId: string): number {
  return slotsInFlight(owner, "connection", connectionId);
}

// A limit setting as a whole number of at least 1. Zero, a negative or an
// invalid value means no limit (null).
export function positiveLimit(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : null;
}

// providerStrategies[provider].maxInFlightPerConnection. A missing, zero, or
// invalid value means no limit.
export function maxInFlightPerConnection(settings: Record<string, any>, provider: string): number | null {
  return positiveLimit(settings.providerStrategies?.[provider]?.maxInFlightPerConnection);
}

// The in-flight limit of one Connection. The Connection's own data.maxInFlight
// wins; else the provider-wide maxInFlightPerConnection applies; else no limit.
export function connectionInFlightLimit(
  settings: Record<string, any>,
  connection: { provider: string; data?: Record<string, unknown> | null },
): number | null {
  return positiveLimit(connection.data?.maxInFlight) ?? maxInFlightPerConnection(settings, connection.provider);
}

// Synchronous on purpose: call it right after selection, before any await,
// so two requests cannot both take the last slot of one Connection.
export function acquireConnectionSlot(
  owner: SlotOwner,
  input: { connectionId: string; provider: string; model: string; apiKey?: string | null },
): ConnectionSlot {
  const { connectionId, provider, model } = input;
  const apiKey = input.apiKey || null;
  const releaseCount = takeSlot(owner, "connection", connectionId);
  owner.repos.usage.pendingStart(connectionId, model, provider, apiKey);
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      releaseCount();
      owner.repos.usage.pendingEnd(connectionId, model, provider, apiKey);
    },
  };
}
