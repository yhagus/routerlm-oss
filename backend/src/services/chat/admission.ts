// Admission control for chat and media routes.
//
// Each request takes one global slot and, when it has an API key, one slot
// for that key. A full key gets 429; a full global cap gets 503. Both carry
// Retry-After. LobakAI does not queue. Slots live in inFlightSlots.ts, the
// one in-flight counter.
//
// Settings:
// - maxInFlightRequests: global cap. Missing means the default; 0 means no cap.
// - maxFallbackConnections: Connections one request tries in the account
//   Fallback loop. Missing means the default; 0 means no cap.
// - apiKeys.maxConcurrency: per-key limit. Missing or 0 means no limit.
import { BUSY_RETRY_AFTER_SECONDS, positiveLimit, slotsInFlight, takeSlot, type SlotOwner } from "./inFlightSlots";
import { gatewayBusyResponse, type GatewayErrorSource } from "./gatewayError";

export const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 2500;
export const DEFAULT_MAX_FALLBACK_CONNECTIONS = 5;

const GLOBAL_SLOT = "all";

type AdmissionKey = { id?: string | null; maxConcurrency?: number | null } | null | undefined;

// A missing setting uses the default. Zero or a negative value turns the
// limit off (null).
function limitSetting(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  if (!Number.isFinite(Number(value))) return fallback;
  return positiveLimit(value);
}

export function maxInFlightRequests(settings: Record<string, any>): number | null {
  return limitSetting(settings.maxInFlightRequests, DEFAULT_MAX_IN_FLIGHT_REQUESTS);
}

export function maxFallbackConnections(settings: Record<string, any>): number | null {
  return limitSetting(settings.maxFallbackConnections, DEFAULT_MAX_FALLBACK_CONNECTIONS);
}

function keyLimit(apiKey: AdmissionKey): number | null {
  return positiveLimit(apiKey?.maxConcurrency);
}

export type Admission =
  | { admitted: true; release: () => void }
  | { admitted: false; response: Response };

// Synchronous: the check and the slot take happen with no await between.
export function admitRequest(owner: SlotOwner, apiKey: AdmissionKey, source: GatewayErrorSource): Admission {
  const keyId = apiKey?.id ? String(apiKey.id) : null;
  const perKey = keyLimit(apiKey);
  if (keyId && perKey && slotsInFlight(owner, "apiKey", keyId) >= perKey) {
    return { admitted: false, response: gatewayBusyResponse(429, source, BUSY_RETRY_AFTER_SECONDS) };
  }
  const cap = maxInFlightRequests(owner.repos.settings.get() as Record<string, any>);
  if (cap && slotsInFlight(owner, "global", GLOBAL_SLOT) >= cap) {
    return { admitted: false, response: gatewayBusyResponse(503, source, BUSY_RETRY_AFTER_SECONDS) };
  }
  const releaseGlobal = takeSlot(owner, "global", GLOBAL_SLOT);
  const releaseKey = keyId ? takeSlot(owner, "apiKey", keyId) : null;
  return {
    admitted: true,
    release: () => {
      releaseGlobal();
      releaseKey?.();
    },
  };
}

// Calls release once the response body is fully read, fails, or the client
// cancels it. A response without a body releases at once.
export function releaseWhenDone(response: Response, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          release();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        release();
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
      release();
    },
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// Admits the request, runs the handler, and holds the slots until the
// response ends. A throw from the handler releases the slots.
export async function withAdmission(
  owner: SlotOwner,
  apiKey: AdmissionKey,
  source: GatewayErrorSource,
  handle: () => Promise<Response> | Response,
): Promise<Response> {
  const admission = admitRequest(owner, apiKey, source);
  if (!admission.admitted) return admission.response;
  let response: Response;
  try {
    response = await handle();
  } catch (error) {
    admission.release();
    throw error;
  }
  return releaseWhenDone(response, admission.release);
}
