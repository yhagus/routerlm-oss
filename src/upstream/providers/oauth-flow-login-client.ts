import type {
  DeviceAuthorization,
  OauthLoginEndpoint,
  PendingDeviceCode,
  TokenPoll,
  TokenRefresh,
} from "../models/oauth-device-grant.js";

/** The sign-in and refresh of one OAuth Login flow, at that flow's endpoint. */
export interface OauthFlowLoginClient<Endpoint extends OauthLoginEndpoint> {
  /** Asks for the code the User approves. Throws OauthLoginError. */
  authorizeDevice(endpoint: Endpoint): Promise<DeviceAuthorization>;
  /** Asks once whether the User has approved. Never throws for an HTTP failure. */
  pollToken(endpoint: Endpoint, pending: PendingDeviceCode): Promise<TokenPoll>;
  /** Trades the refresh token for new tokens. Never throws for an HTTP failure. */
  refreshTokens(endpoint: Endpoint, refreshToken: string): Promise<TokenRefresh>;
}
