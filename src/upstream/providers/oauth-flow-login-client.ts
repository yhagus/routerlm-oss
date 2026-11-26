import type {
  DeviceAuthorization,
  OauthLoginEndpoint,
  PendingDeviceCode,
  TokenPoll,
  TokenRefresh,
} from "@/upstream/models/oauth-device-grant";

export interface OauthFlowLoginClient<Endpoint extends OauthLoginEndpoint> {
  authorizeDevice(endpoint: Endpoint): Promise<DeviceAuthorization>;
  pollToken(endpoint: Endpoint, pending: PendingDeviceCode): Promise<TokenPoll>;
  refreshTokens(endpoint: Endpoint, refreshToken: string): Promise<TokenRefresh>;
}
