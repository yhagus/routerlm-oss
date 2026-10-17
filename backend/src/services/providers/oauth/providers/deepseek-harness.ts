import { deepseekHarnessPlatformHeaders } from "../../deepseekHarnessPlatform.ts";
import crypto from "crypto";
import os from "os";

// DeepSeek Harness (dsh) account flow — PKCE-like browser login against the
// DeepSeek Platform auth-api, ported from dsh deepseek-account-platform.
//
// Flow (dsh parity):
//  1. POST {platform}/auth-api/v0/dsh/auth_init with code_challenge (S256),
//     state, redirect_uri, locale, login_source → {authorize_url, authorize_id, expires_in}
//  2. User signs in at authorize_url; Platform redirects to redirect_uri with ?code&state
//  3. POST {platform}/auth-api/v0/dsh/auth_exchange with code, code_verifier,
//     redirect_uri, device_id, device_model, os_version → {token, authorized_url, user}
//  4. token is used as x-dsh-auth-token for inference (no refresh token; 401 = re-login)
//
// auth_init runs in prepareConfig (the route injects redirect_uri into meta for
// this provider); the attempt (authorize_id + code_verifier) is held here keyed
// by state until exchangeToken. loginTraceID is the field generateAuthData
// reads as the callback state, so the OAuth modal round-trips it verbatim.

const PLATFORM_ORIGIN = "https://platform.deepseek.com";
const AUTH_INIT_URL = `${PLATFORM_ORIGIN}/auth-api/v0/dsh/auth_init`;
const AUTH_EXCHANGE_URL = `${PLATFORM_ORIGIN}/auth-api/v0/dsh/auth_exchange`;
// DeepSeek registers one device identity for the local account installation.
const DEVICE_ID = crypto.randomUUID();

// dsh response envelope: {code: 0, data: {biz_code: 0, biz_data: ...}}
async function unwrapPlatformResponse(response: Response): Promise<any> {
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`DeepSeek Harness platform returned non-JSON response (${response.status})`);
  }
  const code = Number(payload?.code);
  const bizCode = payload?.data?.biz_code === undefined ? undefined : Number(payload.data.biz_code);
  if (code === 40003) {
    throw new Error("DeepSeek Harness account token rejected; sign in again");
  }
  // The official envelope is { code: 0, data: { biz_code: 0, biz_data } }.
  // Some remote gateways preserve the payload but flatten data to { data }.
  if (code === 0 && bizCode === undefined) {
    if (payload?.data?.biz_data !== undefined) return payload.data.biz_data;
    return payload.data;
  }
  if (code !== 0 || bizCode !== 0) {
    const detail = payload?.data?.biz_data?.message
      || payload?.data?.biz_msg
      || payload?.data?.message
      || payload?.msg
      || payload?.message
      || `biz_code=${String(payload?.data?.biz_code ?? "unknown")}; response_keys=${Object.keys(payload || {}).join(",")}`;
    throw new Error(`DeepSeek Harness platform error: ${detail}`);
  }
  return payload.data.biz_data;
}

interface DshAttempt {
  authorizeId: string;
  codeVerifier: string;
  redirectUri: string;
}

// Pending auth attempts keyed by state — auth_init runs during authorize and
// the attempt must survive until exchangeToken.
const pendingAttempts = new Map<string, DshAttempt>();

// Best-effort cleanup: attempts never live longer than 15 minutes.
const ATTEMPT_TTL_MS = 15 * 60 * 1000;
setInterval(() => {
  pendingAttempts.clear();
}, ATTEMPT_TTL_MS).unref?.();

const deepseekHarness: any = {
  config: {
    platformOrigin: PLATFORM_ORIGIN,
  },
  flowType: "authorization_code_pkce",
  callbackPath: "/oauth/callback",
  // Runs auth_init when the route injects redirect_uri into meta (authorize step).
  prepareConfig: async (config: any, meta: any) => {
    const requestedRedirectUri = meta?.redirect_uri || meta?.redirectUri;
    if (!requestedRedirectUri) return config;

    // Official DeepSeek validates loginOrigin and accepts loopback HTTP only.
    // Keep the callback on the dashboard's standard local port for VM/SSH
    // forwarding instead of sending a remote host or VM address upstream.
    let redirectUri = requestedRedirectUri;
    try {
      const parsed = new URL(requestedRedirectUri);
      if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
        redirectUri = "http://localhost:20130/oauth/callback";
      }
    } catch {
      redirectUri = "http://localhost:20130/oauth/callback";
    }

    const codeVerifier = crypto.randomBytes(48).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(32).toString("base64url");

    const response = await fetch(AUTH_INIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...deepseekHarnessPlatformHeaders(),
      },
      body: JSON.stringify({
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        redirect_uri: redirectUri,
        locale: "en_US",
        login_source: "web",
      }),
    });
    if (!response.ok) {
      throw new Error(`DeepSeek Harness auth_init failed: ${response.status} ${await response.text()}`);
    }
    const data = await unwrapPlatformResponse(response);
    if (!data?.authorize_url || !data?.authorize_id) {
      throw new Error("DeepSeek Harness auth_init returned no authorize_url");
    }
    pendingAttempts.set(state, { authorizeId: data.authorize_id, codeVerifier, redirectUri });
    return { ...config, authorizeUrl: data.authorize_url, loginTraceID: state };
  },
  // authorize_url comes fully-formed from auth_init; no query params to append.
  buildAuthUrl: (config: any) => {
    if (!config.authorizeUrl) throw new Error("DeepSeek Harness authorize_url missing (auth_init not run)");
    return config.authorizeUrl;
  },
  exchangeToken: async (_config: any, code: any, redirectUri: any, codeVerifier: any, state: any) => {
    // The real verifier lives in the pending attempt keyed by state; the
    // codeVerifier argument is the throwaway PKCE pair generateAuthData made.
    const attempt = state ? pendingAttempts.get(state) : undefined;
    const verifier = attempt?.codeVerifier || codeVerifier;
    const effectiveRedirectUri = attempt?.redirectUri || redirectUri;
    if (!verifier) throw new Error("DeepSeek Harness exchange missing code verifier");
    if (!effectiveRedirectUri) throw new Error("DeepSeek Harness exchange missing redirect_uri");

    const response = await fetch(AUTH_EXCHANGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...deepseekHarnessPlatformHeaders(),
      },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        redirect_uri: effectiveRedirectUri,
        device_id: DEVICE_ID,
        device_model: `${process.platform}-${process.arch}`,
        os_version: `${process.platform} ${os.release()}`,
      }),
    });
    if (!response.ok) {
      throw new Error(`DeepSeek Harness auth_exchange failed: ${response.status} ${await response.text()}`);
    }
    const data = await unwrapPlatformResponse(response);
    if (!data?.token) throw new Error("DeepSeek Harness auth_exchange returned no token");
    if (state) pendingAttempts.delete(state);
    return { ...data, _dshDeviceId: DEVICE_ID };
  },
  mapTokens: (tokens: any) => {
    const mapped: any = {
      accessToken: tokens.token,
      providerSpecificData: {
        authMethod: "dsh_account",
        ...(tokens._dshDeviceId ? { deviceId: tokens._dshDeviceId } : {}),
      },
    };
    // Optional user payload from auth_exchange (dsh profile projection)
    const user = tokens.user;
    if (user?.email) mapped.email = user.email;
    if (user?.id) mapped.providerSpecificData.userId = String(user.id);
    if (user?.id_profile?.name) mapped.displayName = user.id_profile.name;
    return mapped;
  },
};

export default deepseekHarness;
