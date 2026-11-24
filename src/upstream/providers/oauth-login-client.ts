import { Injectable } from "@nestjs/common";
import type {
  DeviceAuthorization,
  OauthLoginEndpoint,
  OauthProfile,
  PendingDeviceCode,
  TokenPoll,
  TokenRefresh,
} from "@/upstream/models/oauth-device-grant.js";
import { KimiCodeLoginClient } from "./kimi-code-login-client.js";
import type { OauthFlowLoginClient } from "./oauth-flow-login-client.js";
import { OpenAiCodexLoginClient } from "./openai-codex-login-client.js";

type OauthLoginFlow = OauthLoginEndpoint["flow"];
type EndpointOf<Flow extends OauthLoginFlow> = Extract<OauthLoginEndpoint, { flow: Flow }>;
type FlowLoginClients = { [Flow in OauthLoginFlow]: OauthFlowLoginClient<EndpointOf<Flow>> };

@Injectable()
export class OauthLoginClient implements OauthFlowLoginClient<OauthLoginEndpoint> {
  private readonly flowClients: FlowLoginClients;

  constructor(
    private readonly kimiCode: KimiCodeLoginClient,
    openAiCodex: OpenAiCodexLoginClient,
  ) {
    this.flowClients = { "kimi-code": kimiCode, "openai-codex": openAiCodex };
  }

  authorizeDevice(endpoint: OauthLoginEndpoint): Promise<DeviceAuthorization> {
    return this.clientOf(endpoint).authorizeDevice(endpoint);
  }

  pollToken(endpoint: OauthLoginEndpoint, pending: PendingDeviceCode): Promise<TokenPoll> {
    return this.clientOf(endpoint).pollToken(endpoint, pending);
  }

  refreshTokens(endpoint: OauthLoginEndpoint, refreshToken: string): Promise<TokenRefresh> {
    return this.clientOf(endpoint).refreshTokens(endpoint, refreshToken);
  }

  readKimiCodeProfile(baseUrl: string, accessToken: string): Promise<OauthProfile | null> {
    return this.kimiCode.readProfile(baseUrl, accessToken);
  }

  private clientOf<Flow extends OauthLoginFlow>(
    endpoint: EndpointOf<Flow>,
  ): OauthFlowLoginClient<EndpointOf<Flow>> {
    return this.flowClients[endpoint.flow];
  }
}
