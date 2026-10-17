/**
 * Qoder PAT → session token exchange (matches qodercli loginWithPAT).
 *
 * Raw pt-... tokens cannot be used as COSY security_oauth_token. Always
 * exchange via openapi.qoder.sh/api/v1/jobToken/exchange first.
 */

import {
  QODER_CLI_USER_AGENT,
  QODER_JOB_TOKEN_EXCHANGE_URL,
  QODER_USERINFO_URL,
} from "./constants.ts";

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: any, init: any = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert upstream expiry to Unix-ms. Same rules as QoderService.parseExpiry.
 */
export function parseQoderExpiry(expiresAt: any, expiresInSeconds: any) {
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) {
    return expiresAt;
  }
  const trimmed = typeof expiresAt === "string" ? expiresAt.trim() : "";
  if (trimmed) {
    if (/^\d+$/.test(trimmed)) {
      const ms = Number.parseInt(trimmed, 10);
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds) && expiresInSeconds >= 0) {
    return Date.now() + expiresInSeconds * 1000;
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1000;
}

/**
 * POST /api/v1/jobToken/exchange { personal_token }
 * @returns {{ accessToken: string, refreshToken: string, expireTime: number, rawResponse: object }}
 */
export async function exchangeQoderPat(personalAccessToken: any) {
  const pat = typeof personalAccessToken === "string" ? personalAccessToken.trim() : "";
  if (!pat) throw new Error("exchangeQoderPat: missing personal access token");

  const response = await fetchWithTimeout(QODER_JOB_TOKEN_EXCHANGE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": QODER_CLI_USER_AGENT,
    },
    body: JSON.stringify({ personal_token: pat }),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      (body && (body.message || body.error || body.error_description)) ||
      text?.slice(0, 200) ||
      `HTTP ${response.status}`;
    throw new Error(`Qoder PAT exchange failed: ${message}`);
  }

  if (!body || typeof body !== "object") {
    throw new Error("Qoder PAT exchange returned invalid JSON");
  }

  const accessToken = String(
    body.token || body.device_token || body.access_token || "",
  ).trim();
  if (!accessToken) {
    throw new Error("Qoder PAT exchange returned no session token");
  }

  const refreshToken = String(body.refresh_token || body.refreshToken || "").trim();
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? body.expires_in
      : undefined;

  return {
    accessToken,
    refreshToken,
    expireTime: parseQoderExpiry(
      body.expires_at ?? body.expire_time ?? body.expireTime,
      expiresIn,
    ),
    rawResponse: body,
  };
}

/**
 * Best-effort OpenAPI userinfo for a session token.
 */
export async function fetchQoderUserInfo(accessToken: any) {
  try {
    const response = await fetchWithTimeout(QODER_USERINFO_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": QODER_CLI_USER_AGENT,
      },
    });
    if (!response.ok) return { name: "", email: "", userId: "", organizationId: "" };
    const body = await response.json();
    return {
      name: (body.name || body.username || "").trim(),
      email: (body.email || "").trim(),
      organizationId: (body.organization_id || "").trim(),
      userId: String(body.uid || body.user_id || body.id || "").trim(),
    };
  } catch {
    return { name: "", email: "", userId: "", organizationId: "" };
  }
}

/**
 * Full PAT login: exchange + userinfo (qodercli loginWithPAT).
 */
export async function loginWithQoderPat(personalAccessToken: any) {
  const pat = typeof personalAccessToken === "string" ? personalAccessToken.trim() : "";
  if (!pat) throw new Error("loginWithQoderPat: missing personal access token");

  const exchanged = await exchangeQoderPat(pat);
  const userInfo = await fetchQoderUserInfo(exchanged.accessToken);

  return {
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken || "",
    userId: userInfo.userId || "",
    expireTime: exchanged.expireTime,
    name: userInfo.name || "",
    email: userInfo.email || "",
    organizationId: userInfo.organizationId || "",
    personalAccessToken: pat,
  };
}
