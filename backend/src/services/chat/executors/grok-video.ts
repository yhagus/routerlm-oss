import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../../providers/config/providers.ts";
import { refreshProviderCredentials, shouldRefreshCredentials } from "../../providers/oauth/oauthCredentialManager.ts";
import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { getConsistentMachineId } from "../../providers/cli-auth/machineId.ts";

/**
 * Grok Video Executor — for video generation (grok-imagine-video)
 * Uses api.x.ai/v1/videos/generations endpoint
 */
export class GrokVideoExecutor extends BaseExecutor {
  _agentId: any;
  _currentReqId: any;
  constructor() {
    super("grok-cli-video", PROVIDERS["grok-cli"] || {});
    this._currentReqId = null;
    this._agentId = null;
  }

  buildUrl() {
    return "https://api.x.ai/v1/videos/generations";
  }

  async refreshCredentials(credentials: any, log: any, proxyOptions: any = null) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("grok-cli", credentials, log, proxyOptions);
  }

  needsRefresh(credentials: any) {
    return shouldRefreshCredentials("grok-cli", credentials);
  }

  buildHeaders(credentials: any, stream = false) {
    const headers = super.buildHeaders(credentials, stream);

    headers["x-grok-client-identifier"] = "grok-shell";
    headers["x-grok-client-version"] = "1.0.13";
    headers["x-grok-client-mode"] = "headless";

    const reqId = this._currentReqId || crypto.randomUUID();
    headers["x-grok-req-id"] = reqId;

    // Identity headers
    const psd = credentials?.providerSpecificData || {};
    const email = psd.email || credentials?.email;
    const userId = psd.userId || credentials?.userId || credentials?.providerUserId;
    if (email) headers["x-email"] = email;
    if (userId) headers["x-userid"] = userId;

    return headers;
  }

  transformRequest(model: any, body: any, stream: any, credentials: any) {
    this._currentReqId = crypto.randomUUID();
    
    // Generate agent ID once per process
    if (!this._agentId && !credentials?.providerSpecificData?.deviceId) {
      try {
        const mid: any = getConsistentMachineId("grok-video-agent");
        this._agentId = [
          mid.slice(0, 8),
          mid.slice(8, 12),
          "5" + mid.slice(13, 16),
          "a" + mid.slice(17, 20),
          mid.slice(0, 12).padEnd(12, "0"),
        ].join("-");
      } catch {
        this._agentId = crypto.randomUUID();
      }
    } else if (credentials?.providerSpecificData?.deviceId) {
      this._agentId = credentials.providerSpecificData.deviceId;
    }

    if (this._agentId) {
      body.agent_id = this._agentId;
    }

    return body;
  }

  async execute(args: any) {
    const response = await proxyAwareFetch(this.buildUrl(), {
      method: "POST",
      headers: this.buildHeaders(args.credentials, false),
      body: JSON.stringify(this.transformRequest(args.model, args.body, false, args.credentials)),
    }, args.proxyOptions);

    return {
      response,
      output: await response.json(),
      success: response.ok,
    };
  }
}

// Note: This is a placeholder - actual video generation uses a different API structure
// The official CLI uses job-based async flows with polling
export default GrokVideoExecutor;
