import { Injectable } from "@nestjs/common";
import type {
  DeviceAuthorization,
  OauthLoginEndpoint,
  OauthProfile,
  PendingDeviceCode,
  TokenPoll,
  TokenRefresh,
} from "../models/oauth-device-grant.js";
import { KimiCodeLoginClient } from "./kimi-code-login-client.js";
import { OpenAiCodexLoginClient } from "./openai-codex-login-client.js";

/**
 * A Provider's sign-in and the refresh of the login it grants, whichever
 * flow the Provider signs in with (ADR 0012, 0013): each flow is code of its
 * own, and this hands the call to it.
 */
@Injectable()
export class OauthLoginClient {
  constructor(
    private readonly kimiCode: KimiCodeLoginClient,
    private readonly openAiCodex: OpenAiCodexLoginClient,
  ) {}

  /** Asks for the code the User approves. Throws OauthLoginError. */
  authorizeDevice(endpoint: OauthLoginEndpoint): Promise<DeviceAuthorization> {
    return endpoint.flow === "kimi-code"
      ? this.kimiCode.authorizeDevice(endpoint)
      : this.openAiCodex.authorizeDevice(endpoint);
  }

  /** Asks once whether the User has approved. Never throws for an HTTP failure. */
  pollToken(endpoint: OauthLoginEndpoint, pending: PendingDeviceCode): Promise<TokenPoll> {
    return endpoint.flow === "kimi-code"
      ? this.kimiCode.pollToken(endpoint, pending.deviceCode)
      : this.openAiCodex.pollToken(endpoint, pending);
  }

  /** Trades the refresh token for new tokens. Never throws for an HTTP failure. */
  refreshTokens(endpoint: OauthLoginEndpoint, refreshToken: string): Promise<TokenRefresh> {
    return endpoint.flow === "kimi-code"
      ? this.kimiCode.refreshTokens(endpoint, refreshToken)
      : this.openAiCodex.refreshTokens(endpoint, refreshToken);
  }

  /** Kimi Code's profile of the access token's owner; see KimiCodeLoginClient.readProfile. */
  readKimiCodeProfile(baseUrl: string, accessToken: string): Promise<OauthProfile | null> {
    return this.kimiCode.readProfile(baseUrl, accessToken);
  }
}
