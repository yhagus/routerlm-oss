// Single error-mapping service for the three chat gateway surfaces:
// /v1/chat/completions (openai), /responses (responses), /v1/messages (claude).
// The client receives a mapped status and a generic templated message. Raw
// upstream text never reaches the client: it stays in server logs, request
// details, and the non-enumerated `response.upstreamError` property used by
// combo fallback classification.
import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../providers/config/errorConfig.ts";

export type GatewayErrorSource = "openai" | "claude" | "responses" | "ollama";

// Statuses passed through verbatim. Everything else >= 400 maps to a generic
// shape: exotic provider codes (Anthropic 529, Cloudflare 522/524), unmapped
// 4xx to 400, unmapped 5xx to 502.
const PASSTHROUGH = new Set([400, 401, 402, 403, 404, 406, 408, 409, 422, 429, 500, 502, 503, 504]);

export function mapGatewayErrorStatus(status: unknown): number {
  const code = Number(status);
  if (PASSTHROUGH.has(code)) return code;
  if (!Number.isFinite(code) || code < 400) return 502;
  if (code >= 500) return 502;
  return 400;
}

function errorType(status: number): string {
  const info = (ERROR_TYPES as Record<number, { type: string; code: string }>)[status];
  if (info) return info.type;
  return status >= 500 ? "server_error" : "invalid_request_error";
}

function errorCode(status: number): string {
  const info = (ERROR_TYPES as Record<number, { type: string; code: string }>)[status];
  return info?.code || "";
}

function genericMessage(status: number): string {
  return (DEFAULT_ERROR_MESSAGES as Record<number, string>)[status]
    || (status >= 500 ? (DEFAULT_ERROR_MESSAGES as Record<number, string>)[502] : (DEFAULT_ERROR_MESSAGES as Record<number, string>)[400]);
}

// Client-facing body for a gateway surface. Never includes upstream text.
export function gatewayErrorBody(status: number, source: GatewayErrorSource): Record<string, unknown> {
  const message = genericMessage(status);
  if (source === "claude") {
    return { type: "error", error: { type: errorType(status), message } };
  }
  return { error: { message, type: errorType(status), code: errorCode(status) } };
}

// Client-facing Response for an upstream failure. The raw upstream status and
// message stay available in-process via `response.upstreamError` for fallback
// classification, logging, and request-detail persistence — never serialized
// to the client.
export function gatewayErrorResponse(upstreamStatus: unknown, source: GatewayErrorSource, rawMessage?: unknown): Response {
  const status = mapGatewayErrorStatus(upstreamStatus);
  const response = new Response(JSON.stringify(gatewayErrorBody(status, source)), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
  const raw = typeof rawMessage === "string" ? rawMessage : "";
  (response as Response & { upstreamError?: { status: number; message: string } }).upstreamError = {
    status: Number(upstreamStatus) || status,
    message: raw,
  };
  return response;
}

// Fast rejection when LobakAI has no free capacity (503) or a client is at its
// own limit (429). Same body as gatewayErrorResponse, plus Retry-After.
export function gatewayBusyResponse(status: 429 | 503, source: GatewayErrorSource, retryAfterSeconds: number): Response {
  const response = gatewayErrorResponse(status, source, "No free in-flight capacity");
  response.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  return response;
}

// SSE error frame for streaming clients on a gateway surface.
export function gatewayStreamErrorFrame(status: number, source: GatewayErrorSource): string {
  return `data: ${JSON.stringify(gatewayErrorBody(status, source))}\n\n`;
}
