import type { OauthRegion, ProviderOauthLogin } from "@/db/schemas/index.js";
import type { CliIdentity } from "./cli-identity.js";
import type { OauthTokens } from "./provider-account.js";

/** The auth host a sign-in talks to, and how the gateway presents itself there, by flow. */
export type OauthLoginEndpoint =
  | { flow: "kimi-code"; authHost: string; clientId: string; identity: CliIdentity }
  | { flow: "openai-codex"; issuer: string; clientId: string; cliVersion: string };

/**
 * The auth host of a login, from the Provider's data: for Kimi Code, the one
 * of the region the User's account lives in. Null for a Kimi Code login
 * without a region, which no auth host serves.
 */
export function oauthLoginEndpointOf(
  oauthLogin: ProviderOauthLogin,
  region: OauthRegion | null,
  deviceId: string,
): OauthLoginEndpoint | null {
  switch (oauthLogin.flow) {
    case "kimi-code":
      if (region === null) {
        return null;
      }
      return {
        flow: "kimi-code",
        authHost: oauthLogin.authHosts[region],
        clientId: oauthLogin.clientId,
        identity: { cliVersion: oauthLogin.cliVersion, deviceId },
      };
    case "openai-codex":
      return {
        flow: "openai-codex",
        issuer: oauthLogin.issuer,
        clientId: oauthLogin.clientId,
        cliVersion: oauthLogin.cliVersion,
      };
  }
}

/** Whether a sign-in to the Provider has to name the region the User's account lives in. */
export function signInNeedsRegion(oauthLogin: ProviderOauthLogin): boolean {
  return oauthLogin.flow === "kimi-code";
}

/** The auth host refused to start a sign-in, or could not be reached. */
export class OauthLoginError extends Error {}

/** What a sign-in in progress is polled with: the device code and the code the User types. */
export interface PendingDeviceCode {
  deviceCode: string;
  userCode: string;
}

/**
 * What the auth host hands out to start a device-code sign-in (RFC 8628,
 * section 3.2). OpenAI Codex's device auth id stands in for the device code.
 */
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
