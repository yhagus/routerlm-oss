import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../providers/config/errorConfig.ts";

/**
 * Generic client-facing error message for a given HTTP status code.
 * Used to avoid disclosing raw upstream provider error text to clients while
 * keeping the status code (which clients react to programmatically) unchanged.
 *
 * Falls back to the 502 message for unmapped 5xx codes and the 400 message
 * for unmapped 4xx codes (e.g. Cloudflare 522/524, Anthropic 529).
 *
 * @param {number} statusCode - HTTP status code
 * @returns {string} Templated message
 */
export function templateErrorMessage(statusCode: any) {
  if ((DEFAULT_ERROR_MESSAGES as any)[statusCode]) return (DEFAULT_ERROR_MESSAGES as any)[statusCode];
  if (statusCode >= 500) return DEFAULT_ERROR_MESSAGES[502];
  if (statusCode >= 400) return DEFAULT_ERROR_MESSAGES[400];
  return DEFAULT_ERROR_MESSAGES[503];
}

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode: any, message: any) {
  const errorInfo = (ERROR_TYPES as any)[statusCode] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || (DEFAULT_ERROR_MESSAGES as any)[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode: any, message: any) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/**
 * Write error to SSE stream (for streaming)
 * @param {WritableStreamDefaultWriter} writer - Stream writer
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
export async function writeStreamError(writer: any, statusCode: any, message: any) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

/**
 * Extract the provider error discriminator (type/code) from a raw error body.
 * Providers such as Alibaba Model Studio signal a free-tier exhaustion with
 * error.code === "AllocationQuota.FreeTierOnly". The value is provider-defined;
 * callers match against it explicitly. Returns null when absent.
 */
export function extractUpstreamErrorCode(bodyText: string): string | null {
  if (!bodyText) return null;
  try {
    const json = JSON.parse(bodyText) as any;
    const raw = json?.error?.code ?? json?.error?.type ?? json?.code ?? json?.type;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number, code?: string | null}>}
 */
export async function parseUpstreamError(response: any, executor: any = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  // Provider discriminator (e.g. Alibaba free-tier exhaustion). Kept alongside
  // the message so callers can branch on the exact upstream code.
  const code = extractUpstreamErrorCode(bodyText);

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const msg = parsed.message || (DEFAULT_ERROR_MESSAGES as any)[response.status] || `Upstream error: ${response.status}`;
        return { statusCode: parsed.status || response.status, message: msg, resetsAtMs: parsed.resetsAtMs, disableAccount: parsed.disableAccount || false, code: parsed.code ?? code };
      }
    } catch { /* fall through to default parsing */ }
  }

  let message = "";
  try {
    const json = JSON.parse(bodyText);
    message = json.error?.message || json.message || json.error || bodyText;
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || (DEFAULT_ERROR_MESSAGES as any)[response.status] || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage, code };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number }}
 */
export function createErrorResult(statusCode: any, message: any, resetsAtMs?: any) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message)
  };
}

/**
 * Create error result for provider-caused errors (upstream non-2xx, fetch
 * failures, HTML error pages).
 *
 * Differs from createErrorResult in that the CLIENT-facing Response body uses
 * a generic status-code-templated message (see templateErrorMessage) so raw
 * provider text is never disclosed to end users, while the internal `error`
 * field keeps the original provider message — which is required for:
 *   - markAccountUnavailable / checkFallbackError text classification
 *     (ERROR_RULES: "overloaded", "capacity", "quota exceeded"…)
 *   - server logs & request detail persistence
 *
 * The raw message is also attached as a plain (non-enumerated for HTTP) JS
 * property `response.upstreamError = { status, message }` so that combo.js can
 * classify fallback decisions from the raw text without re-parsing the now-
 * templated response body.
 *
 * @param {number} statusCode - HTTP status code (passed through unchanged)
 * @param {string} rawMessage - Original provider error message (internal only)
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch)
 * @param {boolean} [disableAccount] - If true, permanently disable the account (isActive: false)
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number, disableAccount?: boolean }}
 */
export function createUpstreamErrorResult(statusCode: any, rawMessage: any, resetsAtMs: any, disableAccount = false) {
  const response = errorResponse(statusCode, templateErrorMessage(statusCode));
  // Plain property on the Response object — never serialized into the HTTP body,
  // but readable in-process (e.g. by combo fallback classification).
  (response as any).upstreamError = { status: statusCode, message: rawMessage };
  return {
    success: false,
    status: statusCode,
    error: rawMessage,
    resetsAtMs,
    disableAccount,
    response
  };
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(statusCode: any, message: any, retryAfter: any, retryAfterHuman: any) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec)
      }
    }
  );
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(error: any, provider: any, model: any, statusCode: any) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}
