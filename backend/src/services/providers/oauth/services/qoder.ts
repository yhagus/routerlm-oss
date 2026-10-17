import {
  QODER_DEVICE_TOKEN_URL,
  QODER_LOGIN_URL,
} from "../../../platform/qoder-compat/constants.ts";
import {
  exchangeQoderPat,
  fetchQoderUserInfo,
  loginWithQoderPat,
  parseQoderExpiry,
} from "../../cli-auth/qoder/pat.ts";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

/**
 * Qoder OAuth Service
 *
 * Two auth paths (matching qodercli):
 *   1. Device-token flow (browser): PKCE + poll → dt-... session token.
 *   2. PAT flow: POST /api/v1/jobToken/exchange with personal_token → session
 *      token (security_oauth_token). COSY never accepts raw pt-... tokens.
 *
 * Device tokens live ~30 days; center refresh returns 403 for our device flow.
 * PAT accounts re-exchange the stored personalAccessToken on refresh.
 */

// Timeout for OAuth helper calls. The OAuth modal polls every 2s for up to
// 5 minutes; an individual request that stalls beyond this is treated as a
// failed poll attempt and the next poll iteration retries.
const FETCH_TIMEOUT_MS = 15_000;

function base64Url(buf: any) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Wrap fetch with an AbortController-based timeout. Without this, a stalled
 * upstream socket hangs on Node's default keepalive timeout (minutes) and
 * abandoned polls accumulate hung sockets.
 */
async function fetchWithTimeout(url: any, init: any = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class QoderService {
  /**
   * Generate a PKCE verifier + S256 challenge pair.
   * Uses 32 random bytes (matches qodercli/Veria).
   */
  generatePkcePair() {
    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    return { verifier, challenge };
  }

  /**
   * Initiate the device flow. Returns the URL to open in a browser plus the
   * verifier/nonce/machineId we'll need to poll and to sign future requests.
   */
  initiateDeviceFlow() {
    const { verifier, challenge } = this.generatePkcePair();
    const nonce = uuidv4();
    const machineId = uuidv4();

    const params = new URLSearchParams({
      challenge,
      challenge_method: "S256",
      machine_id: machineId,
      nonce,
    });

    return {
      verificationUriComplete: `${QODER_LOGIN_URL}?${params.toString()}`,
      codeVerifier: verifier,
      nonce,
      machineId,
    };
  }

  /**
   * Single poll attempt. Returns one of:
   *   { status: "pending" }       — keep polling
   *   { status: "ok", token, ... } — user authorized, tokens captured
   *   throws Error                 — terminal failure
   *
   * Upstream returns 202/404 while waiting; 200 with a JSON body when done.
   */
  async pollDeviceToken({ nonce, codeVerifier }: any) {
    if (!nonce || !codeVerifier) {
      throw new Error("pollDeviceToken: missing nonce or code verifier");
    }
    const url = `${QODER_DEVICE_TOKEN_URL}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;

    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Go-http-client/2.0",
      },
    });

    // Pending — server has registered the device code but the user hasn't
    // finished the browser flow yet. Both 202 and 404 mean "keep polling".
    if (response.status === 202 || response.status === 404) {
      return { status: "pending" };
    }

    const text = await response.text();

    if (!response.ok) {
      let message = `Qoder device token poll failed: HTTP ${response.status}`;
      try {
        const body = JSON.parse(text);
        if (body.message) message = `Qoder device token poll failed: ${body.message}`;
      } catch {}
      throw new Error(message);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (err: any) {
      throw new Error(`Qoder device token poll: invalid JSON response (${err.message})`);
    }

    // Defensive: 200 + empty token means the upstream changed shape.
    if (!body.token) {
      throw new Error("Qoder device token poll returned 200 but no token");
    }

    const expireMs = QoderService.parseExpiry(body.expires_at, body.expires_in);

    return {
      status: "ok",
      accessToken: body.token,
      refreshToken: body.refresh_token || "",
      userId: body.user_id || "",
      expireTime: expireMs,
      rawResponse: body,
    };
  }

  /**
   * Fetch profile info for the freshly-issued token. Best-effort — failures
   * shouldn't block login; returning empty strings is fine.
   */
  async fetchUserInfo(accessToken: any) {
    return fetchQoderUserInfo(accessToken);
  }

  /**
   * Exchange a Personal Access Token (pt-...) for a session token.
   * See open-sse/shared/qoder/pat.js (qodercli loginWithPAT).
   */
  async loginWithPAT(personalAccessToken: any) {
    return loginWithQoderPat(personalAccessToken);
  }

  async exchangePersonalToken(personalAccessToken: any) {
    return exchangeQoderPat(personalAccessToken);
  }

  /**
   * Convert the upstream's expiry hint into a Unix-millisecond timestamp.
   * See parseQoderExpiry in open-sse/shared/qoder/pat.js.
   */
  static parseExpiry(expiresAt: any, expiresInSeconds: any) {
    return parseQoderExpiry(expiresAt, expiresInSeconds);
  }
}
