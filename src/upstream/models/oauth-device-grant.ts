import type { OauthRegion, ProviderOauthLogin } from "@/db/schemas/index.js";
import type { CliIdentity } from "./cli-identity.js";
import type { OauthTokens } from "./provider-account.js";

/** The auth host a sign-in talks to, and how the gateway presents itself there. */
export interface OauthLoginEndpoint {
  authHost: string;
  clientId: string;
  identity: CliIdentity;
}

/** The auth host of the region a User's account lives in, from the Provider's data. */
export function oauthLoginEndpointOf(
  oauthLogin: ProviderOauthLogin,
  region: OauthRegion,
  deviceId: string,
): OauthLoginEndpoint {
  return {
    authHost: oauthLogin.authHosts[region],
    clientId: oauthLogin.clientId,
    identity: { cliVersion: oauthLogin.cliVersion, deviceId },
  };
}

/** What the auth host hands out to start a device-code sign-in (RFC 8628, section 3.2). */
export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
}

/** What one poll of the token endpoint says about a sign-in (RFC 8628, section 3.5). */
export type TokenPoll =
  | { kind: "granted"; tokens: OauthTokens }
  | { kind: "pending" }
  /** Still pending, and the auth host wants polls further apart from now on. */
  | { kind: "slow-down" }
  | { kind: "denied" }
  | { kind: "expired" }
  /** No usable answer (transport failure, 5xx, unknown error): worth another poll. */
  | { kind: "unanswered"; reason: string };

/** What the token endpoint says to a refresh (RFC 6749, section 6). */
export type TokenRefresh =
  | { kind: "refreshed"; tokens: OauthTokens }
  /** The login is over: the refresh token is invalid, or the auth host answers 401 or 403. */
  | { kind: "refused"; reason: string }
  /** No usable answer after the retries (transport failure, 429, 5xx): the login may still be good. */
  | { kind: "unanswered"; reason: string };

/** Who signed in, as far as the Provider tells. Each field is null when it doesn't. */
export interface OauthProfile {
  nickname: string | null;
  email: string | null;
  levelName: string | null;
}
