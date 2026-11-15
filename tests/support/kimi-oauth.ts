import type { FakeReply } from "./fake-upstream.js";

// The fake upstream plays Kimi's auth host and its `/me`: these are the
// paths the gateway calls and the answers Kimi gives (spec #28, "OAuth Login").

export const DEVICE_AUTHORIZATION_PATH = "/api/oauth/device_authorization";
export const TOKEN_PATH = "/api/oauth/token";
/** Relative to the fake upstream's origin: its base URL ends in `/v1`. */
export const PROFILE_PATH = "/v1/me";

export const DEVICE_CODE = "device-code-0123456789";
export const USER_CODE = "WDJB-MJHT";
export const ACCESS_TOKEN = "kimi-access-token-0123456789";
export const REFRESH_TOKEN = "kimi-refresh-token-9876543210";

/** Starts a sign-in whose code lasts `expiresIn` seconds and is polled every `interval` seconds. */
export function deviceAuthorizationReply(timing: {
  expiresIn: number;
  interval?: number;
}): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      device_code: DEVICE_CODE,
      user_code: USER_CODE,
      verification_uri: "https://www.kimi.com/code/authorize",
      verification_uri_complete: `https://www.kimi.com/code/authorize?user_code=${USER_CODE}`,
      expires_in: timing.expiresIn,
      interval: timing.interval,
    },
  };
}

/** What the token endpoint answers until the User approves, and how it refuses. */
export function tokenErrorReply(
  error: "authorization_pending" | "slow_down" | "access_denied" | "expired_token",
): FakeReply {
  return { kind: "json", status: 400, body: { error } };
}

export function grantedTokensReply(): FakeReply {
  return {
    kind: "json",
    status: 200,
    body: {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
      token_type: "Bearer",
    },
  };
}

export function profileReply(profile: {
  nickname?: string;
  email?: string;
  user_level_name?: string;
}): FakeReply {
  return { kind: "json", status: 200, body: profile };
}
