// reasoningReplay/recovery.js
// Ported from grok2api infra/provider/cli/responses_reasoning_recovery.go.
//
// Handles upstream 400 responses that reject opaque reasoning state with markers:
//   - "could not decode the compaction blob"
//   - "could not decrypt the provided encrypted_content"
//
// Recovery (two-stage, never rotates accounts/planes):
//   1. Strip encrypted_content from reasoning items and retry in the SAME session.
//   2. If the decode error persists, clear the server-side session identity and retry
//      once stateless (prompt_cache_key removed).
// A genuine 429 surfaced after stripping is preserved (returned, not masked as 400) so
// the gateway can cool down / rotate accounts. Compatibility warnings are emitted via
// the X-Grok2API-Compatibility-Warnings response header.

export const REASONING_DECODE_FAILURE_MARKERS = [
  "could not decode the compaction blob",
  "could not decrypt the provided encrypted_content",
];

const COMPATIBILITY_WARNING_HEADER = "X-Grok2API-Compatibility-Warnings";

// isReasoningDecodeFailure: true if the (buffer/string) body contains any marker.
export function isReasoningDecodeFailure(body: any) {
  if (!body) return false;
  const lower = (typeof body === "string" ? body : body.toString("utf8")).toLowerCase();
  for (const marker of REASONING_DECODE_FAILURE_MARKERS) {
    if (lower.includes(marker)) return true;
  }
  return false;
}

// stripReasoningEncryptedContent: remove opaque reasoning state while preserving any
// readable summary/content. An encrypted-only reasoning item becomes empty after
// stripping and is removed entirely. Returns { body, changed }.
export function stripReasoningEncryptedContent(body: any) {
  if (!body || typeof body !== "object") return { body, changed: false };
  const input = Array.isArray(body.input) ? body.input : null;
  if (!input || input.length === 0) return { body, changed: false };
  let changed = false;
  const rebuilt: any[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || stringField(raw, "type") !== "reasoning") {
      rebuilt.push(raw);
      continue;
    }
    const encrypted = raw.encrypted_content;
    if (typeof encrypted !== "string" || encrypted.trim() === "") {
      rebuilt.push(raw);
      continue;
    }
    const cleaned = { ...raw };
    delete cleaned.encrypted_content;
    delete cleaned.id;
    delete cleaned.status;
    changed = true;
    if (hasReadableReasoningContent(cleaned)) rebuilt.push(cleaned);
  }
  if (!changed) return { body, changed: false };
  const out = { ...body, input: rebuilt };
  return { body: out, changed };
}

function hasReadableReasoningContent(item: any) {
  for (const field of ["summary", "content"]) {
    const parts = Array.isArray(item[field]) ? item[field] : null;
    if (!parts) continue;
    for (const part of parts) {
      if (part && typeof part === "object" && stringField(part, "text").trim() !== "") return true;
    }
  }
  return false;
}

// removePromptCacheKey: drop prompt_cache_key so the retry is stateless upstream.
export function removePromptCacheKey(body: any) {
  if (!body || typeof body !== "object") return body;
  const out = { ...body };
  delete out.prompt_cache_key;
  return out;
}

// canResetReasoningSession: only safe to reset when this is a POST carrying a
// prompt_cache_key and the client is NOT using previous_response_id (server state).
export function canResetReasoningSession({ method, promptCacheKey, previousResponseId } = {} as any) {
  if (!method || String(method).toUpperCase() !== "POST") return false;
  if (typeof promptCacheKey !== "string" || promptCacheKey.trim() === "") return false;
  const pri = typeof previousResponseId === "string" ? previousResponseId.trim() : "";
  return pri === "";
}

// appendCompatibilityWarning: append (deduped) to the comma-separated warnings header.
export function appendCompatibilityWarning(headers: any, warning: any) {
  if (!headers || typeof headers !== "object" || typeof warning !== "string" || warning.trim() === "") return;
  const existing = typeof headers.get === "function"
    ? String(headers.get(COMPATIBILITY_WARNING_HEADER) ?? "").trim()
    : String(headers[COMPATIBILITY_WARNING_HEADER] ?? "").trim();
  if (existing === "") {
    if (typeof headers.set === "function") headers.set(COMPATIBILITY_WARNING_HEADER, warning);
    else headers[COMPATIBILITY_WARNING_HEADER] = warning;
    return;
  }
  for (const value of existing.split(",")) {
    if (value.trim() === warning) return;
  }
  if (typeof headers.set === "function") headers.set(COMPATIBILITY_WARNING_HEADER, `${existing},${warning}`);
  else headers[COMPATIBILITY_WARNING_HEADER] = `${existing},${warning}`;
}

// recoverReasoningDecodeFailure: orchestrates the two-stage recovery.
//
// Inputs:
//   - response: { status, headers, body } (the original 400). body may be a string
//     or Buffer; if truncated, pass truncated:true to skip recovery.
//   - request: { method, model, sessionKey, promptCacheKey, previousResponseId }
//   - body: the (already Apply-injected) request body object
//   - retry: async ({ body, resetSession }) => { response, url, error }
//     The retry must NOT re-Apply replay (it reuses the prepared body) and should clear
//     session identity when resetSession=true.
//   - onClear: async () => void  (clear the cached replay entry for this scope)
//
// Returns { response, url, outcome } where outcome has:
//   { encryptedContentDowngraded, sessionReset, failed }.
export async function recoverReasoningDecodeFailure({
  response,
  request,
  body,
  retry,
  onClear,
} = {} as any) {
  const noopOutcome = () => ({
    encryptedContentDowngraded: false,
    sessionReset: false,
    failed: false,
  });
  if (!response || response.status !== 400) {
    return { response, url: response?.url, outcome: noopOutcome() };
  }
  const errorBody = response.body;
  const truncated = !!response.truncated;
  const original = response;
  if (truncated || !isReasoningDecodeFailure(errorBody)) {
    return { response: original, url: original.url, outcome: noopOutcome() };
  }
  // Once upstream rejects opaque reasoning, drop the cached entry so the next request
  // doesn't re-inject the same dead ciphertext.
  if (typeof onClear === "function") {
    try {
      await onClear();
    } catch {
      /* fall open */
    }
  }

  const { body: portableBody, changed: encryptedChanged } = stripReasoningEncryptedContent(body);

  if (encryptedChanged) {
    let retryResp;
    try {
      retryResp = await retry({ body: portableBody, resetSession: false });
    } catch {
      return { response: original, url: original.url, outcome: { ...noopOutcome(), failed: true } };
    }
    const retryResponse = retryResp?.response;
    const retryURL = retryResp?.url;
    if (retryResponse && isHTTPSuccess(retryResponse.status)) {
      appendCompatibilityWarning(retryResponse.headers, "reasoning_encrypted_content_downgraded");
      return { response: retryResponse, url: retryURL, outcome: { ...noopOutcome(), encryptedContentDowngraded: true } };
    }
    if (retryResponse && retryResponse.status === 429) {
      // Real rate limit surfaced after stripping — preserve for account cooldown/rotation.
      appendCompatibilityWarning(retryResponse.headers, "reasoning_encrypted_content_downgraded");
      return { response: retryResponse, url: retryURL, outcome: { ...noopOutcome(), encryptedContentDowngraded: true } };
    }
    // Decode error persisted or other failure -> fall through to session reset.
    const sameDecode = retryResponse ? responseHasReasoningDecodeFailure(retryResponse) : false;
    if (!sameDecode) {
      appendCompatibilityWarning(retryResponse ?? original, "reasoning_recovery_failed");
      return { response: retryResponse ?? original, url: retryURL ?? original.url, outcome: { ...noopOutcome(), failed: true } };
    }
  }

  if (!canResetReasoningSession(request)) {
    appendCompatibilityWarning(original.headers, "reasoning_recovery_failed");
    return { response: original, url: original.url, outcome: { ...noopOutcome(), failed: true } };
  }
  const statelessBody = removePromptCacheKey(portableBody);
  let retry2Resp;
  try {
    retry2Resp = await retry({ body: statelessBody, resetSession: true });
  } catch {
    appendCompatibilityWarning(original.headers, "reasoning_recovery_failed");
    return { response: original, url: original.url, outcome: { ...noopOutcome(), failed: true } };
  }
  const retry2Response = retry2Resp?.response;
  const retry2URL = retry2Resp?.url;
  if (retry2Response && retry2Response.status === 429) {
    if (encryptedChanged) appendCompatibilityWarning(retry2Response.headers, "reasoning_encrypted_content_downgraded");
    appendCompatibilityWarning(retry2Response.headers, "reasoning_session_reset");
    return {
      response: retry2Response,
      url: retry2URL,
      outcome: { ...noopOutcome(), encryptedContentDowngraded: encryptedChanged, sessionReset: true },
    };
  }
  if (!retry2Response || !isHTTPSuccess(retry2Response.status)) {
    appendCompatibilityWarning(original.headers, "reasoning_recovery_failed");
    return { response: original, url: original.url, outcome: { ...noopOutcome(), failed: true } };
  }
  if (encryptedChanged) appendCompatibilityWarning(retry2Response.headers, "reasoning_encrypted_content_downgraded");
  appendCompatibilityWarning(retry2Response.headers, "reasoning_session_reset");
  return {
    response: retry2Response,
    url: retry2URL,
    outcome: { ...noopOutcome(), encryptedContentDowngraded: encryptedChanged, sessionReset: true },
  };
}

export function responseHasReasoningDecodeFailure(response: any) {
  if (!response || response.status !== 400) return false;
  return isReasoningDecodeFailure(response.body);
}

function isHTTPSuccess(status: any) {
  return status >= 200 && status < 300;
}

function stringField(obj: any, field: any) {
  if (!obj || typeof obj !== "object") return "";
  const v = obj[field];
  return typeof v === "string" ? v : "";
}
