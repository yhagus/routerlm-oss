// One account Fallback step, shared by every loop that tries Connections in
// turn: chat executors, the legacy gateway, the native Gemini forward, and
// media. A step checks the Fallback cap, selects a Connection, and takes its
// in-flight slot before the caller awaits anything.
import type { ConnectionSelection, SelectedConnection } from "./credentials";
import { acquireConnectionSlot, BUSY_RETRY_AFTER_SECONDS, type ConnectionSlot, type SlotOwner } from "./inFlightSlots";
import { maxFallbackConnections } from "./admission";
import { gatewayBusyResponse, type GatewayErrorSource } from "./gatewayError";

export interface FallbackAttempts {
  // Connections that failed in this request. Selection skips them.
  readonly excludeIds: Set<string>;
  lastError: { status: number; message: string } | null;
  // Most Connections one request tries. Null means no cap.
  readonly cap: number | null;
}

export type AttemptStep =
  | { kind: "attempt"; selected: SelectedConnection; slot: ConnectionSlot | null }
  // The request tried `cap` Connections. Return the last error.
  | { kind: "capped" }
  // Eligible Connections exist, but each one is at its in-flight limit.
  | { kind: "saturated" }
  // No eligible Connection is left.
  | { kind: "none" };

export function fallbackAttempts(settings: Record<string, any>): FallbackAttempts {
  return { excludeIds: new Set(), lastError: null, cap: maxFallbackConnections(settings) };
}

// Synchronous on purpose: the slot is taken right after selection, so two
// requests cannot both take the last slot of one Connection. A synthetic
// Connection (noAuth) takes no slot.
export function nextConnectionAttempt(
  owner: SlotOwner,
  attempts: FallbackAttempts,
  select: (excludeIds: Set<string>) => ConnectionSelection,
  slot: { provider: string; model: string; apiKey: string | null },
): AttemptStep {
  if (attempts.cap && attempts.lastError && attempts.excludeIds.size >= attempts.cap) return { kind: "capped" };
  const selection = select(attempts.excludeIds);
  if (!selection.selected) return { kind: selection.saturated ? "saturated" : "none" };
  const { connection, synthetic } = selection.selected;
  const taken = synthetic ? null : acquireConnectionSlot(owner, { connectionId: connection.id, ...slot });
  return { kind: "attempt", selected: selection.selected, slot: taken };
}

// The Connection failed with a Fallback-classified error: skip it for the
// rest of the request.
export function attemptFailed(attempts: FallbackAttempts, connectionId: string, status: number, message: string): void {
  attempts.excludeIds.add(connectionId);
  attempts.lastError = { status, message };
}

// Every eligible Connection is at its in-flight limit.
export function connectionsBusyResponse(source: GatewayErrorSource): Response {
  return gatewayBusyResponse(503, source, BUSY_RETRY_AFTER_SECONDS);
}
