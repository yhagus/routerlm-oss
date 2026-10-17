// CodeBuddy daily credit check-in. The Tencent billing facade exposes two
// routes: a status probe and a credit claim. The desktop client claims a free
// daily credit grant once per calendar day; the gateway mirrors that so an
// operator can see, per account, whether today's grant was claimed — without
// opening the app.
//
// Contract (from the reverse-engineered desktop bundle, vendor/research):
//   Status : POST {base}/billing/meter/checkin-activity-status  body {}
//   Claim  : POST {base}/billing/meter/daily-checkin            body {}
//   Envelope: { code: 0, data: { today_checked_in, streak_days, ... } }
//   "already claimed" business code is 1001 (NOT 10001 — that belongs to the
//   artifact-release API).
//
// One request per account per day: the status endpoint is asked first and the
// claim fires only when `today_checked_in` is false. A successful claim
// short-circuits the day, so a restart cannot double-post.

import { proxyAwareFetch } from "../common/proxyFetch";

const CHECKIN_STATUS_URL = "https://www.codebuddy.ai/billing/meter/checkin-activity-status";
const CHECKIN_CLAIM_URL = "https://www.codebuddy.ai/billing/meter/daily-checkin";
const TIMEOUT_MS = 15_000;

// Check-in business codes, per the desktop bundle's `mapCheckinStatus()`.
// `1001` is "already claimed" — NOT `10001`, which belongs to the
// artifact-release API and never appears in this path.
const ALREADY_CLAIMED_CODE = 1001;
const NOT_ELIGIBLE_CODE = 1002;
const EVENT_ENDED_CODE = 1003;

// Delays between 5xx/network retries on the claim POST, mirroring the buddy
// gateway's own backoff.
const CLAIM_RETRY_DELAYS_MS = [1_000, 2_000] as const;

export type DailyCheckinState =
  | "claimed"
  | "already_claimed"
  | "not_eligible"
  | "event_ended"
  | "unavailable"
  | "error";

export interface DailyCheckinResult {
  readonly state: DailyCheckinState;
  /** Credits granted by this claim; `null` when nothing was granted. */
  readonly credit: number | null;
  readonly streakDays: number | null;
  /** Provider-facing detail for the audit log; `null` on success. */
  readonly error: string | null;
  /** Raw HTTP request/response detail for the status call, for probe history display. */
  readonly detail?: {
    readonly url: string;
    readonly method: string;
    readonly requestHeaders: Record<string, string>;
    readonly requestBody: string;
    readonly responseStatus: number | null;
    readonly responseStatusText: string | null;
    readonly responseBody: string | null;
    readonly startedAt: string;
    readonly endedAt: string;
  };
}

interface CheckinHeaders {
  readonly authorization: string;
  readonly userAgent: string;
  readonly domain: string;
  readonly product: string;
}

function buildHeaders(token: string): CheckinHeaders {
  return {
    authorization: `Bearer ${token}`,
    userAgent: "CLI/2.154.0 CodeBuddy/2.154.0",
    domain: "www.codebuddy.ai",
    product: "SaaS",
  };
}

function commonHeaders(h: CheckinHeaders): Record<string, string> {
  return {
    "X-Product": h.product,
    "X-Requested-With": "XMLHttpRequest",
    "X-CodeBuddy-Request": "1",
    "X-Domain": h.domain,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": h.userAgent,
    Authorization: h.authorization,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Reads the envelope's business code; `0` means success. */
function envelopeCode(payload: unknown): number | null {
  const envelope = asRecord(payload);
  if (!envelope || !("code" in envelope)) return null;
  return asNumber(envelope["code"]);
}

/**
 * Unwraps the check-in payload. CodeBuddy nests Tencent's
 * `data.Response.Data` (the same double wrap its quota endpoint uses), so both
 * the flat and nested shapes resolve.
 */
function envelopeData(payload: unknown): Record<string, unknown> | null {
  const data = asRecord(asRecord(payload)?.["data"]);
  if (!data) return null;
  if ("today_checked_in" in data || "active" in data || "streak_days" in data) return data;
  return asRecord(asRecord(data["Response"])?.["Data"]);
}

/**
 * Textual "already checked in" fingerprints. The claim POST answers `1001`
 * when the envelope is well-formed, but a locale or gateway variant can answer
 * the same state as prose, so both shapes resolve to `already_claimed`.
 */
function alreadyClaimedMessage(payload: unknown, rawBody: string): string | null {
  const data = asRecord(payload);
  if (!data) return null;
  const direct = data["msg"] ?? data["message"];
  const message = typeof direct === "string" && direct.trim() ? direct.trim() : rawBody.trim();
  if (!message) return null;
  if (message.includes("已签到")) return message;
  const lower = message.toLowerCase();
  if (lower.includes("already") && lower.includes("check")) return message;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when the claim attempt is worth retrying: 5xx or a network throw. */
function isRetryableClaim(error: unknown, status: number | null): boolean {
  if (status !== null) return status >= 500;
  return !(error instanceof DOMException && error.name === "AbortError");
}

/**
 * Performs one account's daily check-in.
 *
 * Status first, claim only when `today_checked_in` is false — so the daily
 * budget is one request for an already-claimed account and two on claim day.
 */
export type CheckinFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchDailyCheckin(args: {
  readonly token: string;
  readonly fetcher?: CheckinFetcher;
  /** Proxy options from resolveConnectionProxyConfig; when provided, requests tunnel through the configured proxy. */
  readonly proxyOptions?: Record<string, unknown>;
}): Promise<DailyCheckinResult> {
  const { token, fetcher, proxyOptions } = args;
  const base = { credit: null, streakDays: null, error: null };

  if (!token) {
    return { ...base, state: "error", error: "Account has no stored credential." };
  }

  const h = buildHeaders(token);
  const headers = commonHeaders(h);

  // When proxyOptions is provided, route through proxyAwareFetch so the
  // connection's proxy pool/per-connection proxy applies. In tests (no
  // proxyOptions), the injected fetcher / globalThis.fetch is used directly.
  const doFetch = (url: string, init: RequestInit): Promise<Response> => {
    if (proxyOptions) return proxyAwareFetch(url, init, proxyOptions);
    return (fetcher ?? globalThis.fetch)(url, init);
  };

  // 1. Status probe — capture raw request/response for probe history display.
  const sanitizedHeaders = { ...headers };
  delete sanitizedHeaders.Authorization;
  const detailBase = {
    url: CHECKIN_STATUS_URL,
    method: "POST",
    requestHeaders: sanitizedHeaders,
    requestBody: "{}",
  };

  let status: unknown;
  let statusDetail: NonNullable<DailyCheckinResult["detail"]> | undefined;
  const statusStartedAt = new Date().toISOString();
  try {
    const response = await doFetch(CHECKIN_STATUS_URL, {
          method: "POST",
          headers,
          body: "{}",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    const statusResponseBody = await response.text().catch(() => "");
    const statusEndedAt = new Date().toISOString();
    statusDetail = {
      ...detailBase,
      responseStatus: response.status,
      responseStatusText: response.statusText,
      responseBody: statusResponseBody.slice(0, 2000),
      startedAt: statusStartedAt,
      endedAt: statusEndedAt,
    };
    if (response.status === 401 || response.status === 403) {
      return { ...base, state: "error", error: "Credential invalid or expired.", detail: statusDetail };
    }
    if (!response.ok) {
      return { ...base, state: "error", error: `Check-in status API error (${response.status}).`, detail: statusDetail };
    }
    try { status = statusResponseBody ? JSON.parse(statusResponseBody) : null; } catch { status = null; }
  } catch (error) {
    const statusEndedAt = new Date().toISOString();
    return {
      ...base,
      state: "error",
      error: error instanceof Error ? error.message : "Check-in status request failed.",
      detail: { ...detailBase, responseStatus: null, responseStatusText: null, responseBody: null, startedAt: statusStartedAt, endedAt: statusEndedAt },
    };
  }

  const statusCode = envelopeCode(status);
  if (statusCode !== null && statusCode !== 0) {
    return { ...base, state: "error", error: `Check-in status error (code ${statusCode}).`, detail: statusDetail };
  }

  const data = envelopeData(status);
  if (!data) return { ...base, state: "unavailable", error: "Check-in activity unavailable.", detail: statusDetail };
  if (data["active"] === false) {
    return { ...base, state: "unavailable", error: "No check-in activity running.", detail: statusDetail };
  }
  const streak = asNumber(data["streak_days"]);
  if (data["today_checked_in"] === true) {
    return { ...base, state: "already_claimed", streakDays: streak, detail: statusDetail };
  }

  // 2. Claim POST with retry on 5xx/network.
  let claim: unknown;
  let claimRaw = "";
  let attempt = 0;
  for (;;) {
    try {
      const response = await doFetch(CHECKIN_CLAIM_URL, {
        method: "POST",
        headers,
        body: "{}",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        return { ...base, state: "error", error: "Credential invalid or expired.", detail: statusDetail };
      }
      if (response.status >= 500 && attempt < CLAIM_RETRY_DELAYS_MS.length) {
        await sleep(CLAIM_RETRY_DELAYS_MS[attempt] as number);
        attempt += 1;
        continue;
      }
      if (!response.ok) {
        return { ...base, state: "error", error: `Daily check-in API error (${response.status}).`, detail: statusDetail };
      }
      claimRaw = await response.text().catch(() => "");
      claim = claimRaw ? JSON.parse(claimRaw) : null;
      break;
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { ...base, state: "error", error: "Daily check-in response returned invalid JSON.", detail: statusDetail };
      }
      if (isRetryableClaim(error, null) && attempt < CLAIM_RETRY_DELAYS_MS.length) {
        await sleep(CLAIM_RETRY_DELAYS_MS[attempt] as number);
        attempt += 1;
        continue;
      }
      return {
        ...base,
        state: "error",
        error: error instanceof Error ? error.message : "Daily check-in request failed.",
        detail: statusDetail,
      };
    }
  }

  const claimCode = envelopeCode(claim);
  if (claimCode !== null && claimCode !== 0) {
    const alreadyText = alreadyClaimedMessage(claim, claimRaw);
    if (claimCode === ALREADY_CLAIMED_CODE || alreadyText) {
      return { ...base, state: "already_claimed", streakDays: streak, detail: statusDetail };
    }
    if (claimCode === NOT_ELIGIBLE_CODE) return { ...base, state: "not_eligible", detail: statusDetail };
    if (claimCode === EVENT_ENDED_CODE) return { ...base, state: "event_ended", detail: statusDetail };
    return { ...base, state: "error", error: `Daily check-in error (code ${claimCode}).`, detail: statusDetail };
  }
  // Some gateway variants answer the duplicate-claim state as prose with a
  // success envelope; catch that before reporting a fresh claim.
  if (claimCode === 0) {
    const alreadyText = alreadyClaimedMessage(claim, claimRaw);
    if (alreadyText) return { ...base, state: "already_claimed", streakDays: streak, detail: statusDetail };
  }

  const claimData = envelopeData(claim);
  return {
    ...base,
    state: "claimed",
    credit: asNumber(claimData?.["credit"]) ?? asNumber(claimData?.["today_credit"]) ?? null,
    streakDays: asNumber(claimData?.["streak_days"]) ?? streak,
    detail: statusDetail,
  };
}
