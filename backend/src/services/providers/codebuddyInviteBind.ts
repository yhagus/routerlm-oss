import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import { proxyAwareFetch } from "../common/proxyFetch";
import { refreshExpiringCredentials } from "./refreshCoordinator";

const BIND_URL = "https://www.codebuddy.ai/activity/workbuddy/invitation/v2/bind";
const USER_AGENT = "CLI/2.154.0 CodeBuddy/2.154.0";
const SETTINGS_KEY_CLI = "codebuddyIntlCliDailyProbe";
const PROVIDERS = new Set(["codebuddy-intl-cli"]);

async function resolveToken(runtime: Runtime, connection: ProviderConnection): Promise<{ token: string; proxy: Record<string, unknown> | undefined }> {
  const psd = resolveV1ProviderSpecificData(connection.data);
  let proxy = resolveConnectionProxyConfig(runtime, psd);
  const hasPerConnectionProxy = proxy.connectionProxyEnabled || proxy.vercelRelayUrl;
  if (!hasPerConnectionProxy) {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const cliConfig = settings[SETTINGS_KEY_CLI] as { proxyPoolId?: string } | undefined;
    if (cliConfig?.proxyPoolId) {
      proxy = resolveConnectionProxyConfig(runtime, { ...psd, proxyPoolId: cliConfig.proxyPoolId });
    }
  }
  const hasActualProxy = proxy.connectionProxyEnabled || proxy.vercelRelayUrl;
  const effectiveProxy = hasActualProxy ? proxy : undefined;
  const credentials: Record<string, any> = {
    ...connection.data,
    authType: connection.authType,
    connectionId: connection.id,
    connectionName: connection.name || connection.id,
    providerSpecificData: { ...psd, ...proxy },
  };
  await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions: effectiveProxy ?? {} });
  const accessToken = typeof credentials.accessToken === "string" && credentials.accessToken
    ? credentials.accessToken
    : typeof credentials.apiKey === "string" ? credentials.apiKey : "";
  if (!accessToken) throw new Error("CodeBuddy credential not available.");
  return { token: accessToken, proxy: effectiveProxy };
}

export interface InviteBindResult {
  ok: boolean;
  connectionId: string;
  error?: string;
  code?: unknown;
  msg?: unknown;
}

export async function bindInviteForConnection(
  runtime: Runtime,
  connectionId: string,
  inviteCode: string,
): Promise<InviteBindResult> {
  const code = inviteCode.trim();
  if (!code) return { ok: false, connectionId, error: "Invite code is required" };
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection) return { ok: false, connectionId, error: "Connection not found" };
  if (!PROVIDERS.has(connection.provider)) {
    return { ok: false, connectionId, error: "Invite bind is only available for CodeBuddy intl connections" };
  }
  try {
    const { token, proxy } = await resolveToken(runtime, connection);
    const response = await proxyAwareFetch(BIND_URL, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        "X-Domain": "www.codebuddy.ai",
        "X-Product": "SaaS",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ inviteCode: code }),
    }, proxy);
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 200 && data.code === 0) {
      runtime.repos.providers.patch(connection.id, { data: { inviteBound: true } });
      return { ok: true, connectionId, code: data.code, msg: data.msg };
    }
    const msg = typeof data.msg === "string" ? data.msg : `Invite bind failed (HTTP ${response.status})`;
    return { ok: false, connectionId, error: msg, code: data.code, msg: data.msg };
  } catch (error) {
    return { ok: false, connectionId, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function bindInviteForConnections(
  runtime: Runtime,
  connectionIds: string[],
  inviteCode: string,
): Promise<{ success: number; failed: number; results: InviteBindResult[] }> {
  const results: InviteBindResult[] = [];
  for (const id of connectionIds) {
    results.push(await bindInviteForConnection(runtime, id, inviteCode));
  }
  return {
    success: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
