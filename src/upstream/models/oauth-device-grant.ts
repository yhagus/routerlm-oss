import type { OauthRegion, ProviderOauthLogin } from "@/db/schemas/index.js";
import type { CliIdentity } from "./cli-identity.js";
import type { OauthTokens } from "./provider-account.js";

export type OauthLoginEndpoint =
  | { flow: "kimi-code"; authHost: string; clientId: string; identity: CliIdentity }
  | { flow: "openai-codex"; issuer: string; clientId: string; cliVersion: string };

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

export function signInNeedsRegion(oauthLogin: ProviderOauthLogin): boolean {
  return oauthLogin.flow === "kimi-code";
}

export class OauthLoginError extends Error {}

export interface PendingDeviceCode {
  deviceCode: string;
  userCode: string;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
}

export type TokenPoll =
  | { kind: "granted"; tokens: OauthTokens }
  | { kind: "pending" }
  | { kind: "slow-down" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "unanswered"; reason: string };

export type TokenRefresh =
  | { kind: "refreshed"; tokens: OauthTokens }
  | { kind: "refused"; reason: string }
  | { kind: "unanswered"; reason: string };

export interface OauthProfile {
  nickname: string | null;
  email: string | null;
  levelName: string | null;
}
