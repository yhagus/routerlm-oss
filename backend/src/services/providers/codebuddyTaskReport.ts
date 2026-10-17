import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import { proxyAwareFetch } from "../common/proxyFetch";
import { refreshExpiringCredentials } from "./refreshCoordinator";

const REPORT_URL = "https://www.codebuddy.ai/v2/report";
const SETTINGS_KEY_CLI = "codebuddyIntlCliDailyProbe";
const PROVIDERS = new Set(["codebuddy-intl-cli"]);
const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

async function resolveToken(runtime: Runtime, connection: ProviderConnection): Promise<{
  token: string;
  proxy: Record<string, unknown> | undefined;
  credentials: Record<string, any>;
}> {
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
    email: connection.email,
    providerSpecificData: { ...psd, ...proxy },
  };
  await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions: effectiveProxy ?? {} });
  const accessToken = typeof credentials.accessToken === "string" && credentials.accessToken
    ? credentials.accessToken
    : typeof credentials.apiKey === "string" ? credentials.apiKey : "";
  if (!accessToken) throw new Error("CodeBuddy credential not available.");
  return { token: accessToken, proxy: effectiveProxy, credentials };
}

function snowflake(): string {
  return String((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 0x3fffff)));
}

export function buildAgentTaskEvent(
  connection: ProviderConnection,
  credentials: Record<string, any>,
  ids?: { conversationId?: string; messageId?: string },
): Record<string, unknown> {
  const psd = credentials?.providerSpecificData && typeof credentials.providerSpecificData === "object"
    ? credentials.providerSpecificData
    : {};
  const userId = String(credentials?.codebuddyUserId || psd.codebuddyUserId || "");
  const userNickname = String(
    credentials?.codebuddyNickname || psd.codebuddyNickname || connection.email || connection.name || "",
  );
  const timestamp = Date.now();
  const conversationId = ids?.conversationId || snowflake();
  const messageId = ids?.messageId || "";
  return {
    eventCode: "agent_task_created",
    timestamp,
    reportDelay: 0,
    userId,
    userNickname,
    userAgent: WEB_UA,
    os: "MacIntel",
    timezone: "Asia/Jakarta",
    has_repo: false,
    repo_type: "none",
    workspace_type: "empty",
    has_connector: false,
    connector_types: [],
    has_mention: false,
    mention_types: [],
    has_template: false,
    template_name: "",
    conversationId,
    requestModelName: "Hy4 preview",
    has_expert: false,
    expert_id: "",
    expert_name: "",
    expert_industry_id: "",
    has_skill: false,
    skill_names: [],
    requestId: messageId || `${conversationId}-${timestamp}`,
    messageId,
    ideName: "web_agents",
    ideType: "WorkBuddy_Web",
    machineId: crypto.randomUUID(),
    source: "CLOUD",
    name: "working",
    mode: "craft",
    requestModelId: "hy4-preview",
    action: "",
  };
}

export async function postAgentTaskReport(
  token: string,
  proxy: Record<string, unknown> | undefined,
  event: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const uid = typeof event.userId === "string" ? event.userId : "";
  const response = await proxyAwareFetch(REPORT_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": WEB_UA,
      Origin: "https://www.codebuddy.ai",
      "X-Domain": "www.codebuddy.ai",
      "X-Product": "SaaS",
      "X-Requested-With": "XMLHttpRequest",
      ...(uid ? { "X-User-Id": uid } : { "X-No-User-Id": "1" }),
    },
    body: JSON.stringify([event]),
    signal: AbortSignal.timeout(30_000),
  }, proxy);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      error: text ? `Report failed (HTTP ${response.status}): ${text.slice(0, 240)}` : `Report failed (HTTP ${response.status})`,
    };
  }
  return { ok: true, status: response.status };
}

export interface TaskReportResult {
  ok: boolean;
  connectionId: string;
  error?: string;
  status?: number;
}

export async function reportAgentTaskForConnection(
  runtime: Runtime,
  connectionId: string,
): Promise<TaskReportResult> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection) return { ok: false, connectionId, error: "Connection not found" };
  if (!PROVIDERS.has(connection.provider)) {
    return { ok: false, connectionId, error: "Report task is only available for CodeBuddy intl connections" };
  }
  try {
    const { token, proxy, credentials } = await resolveToken(runtime, connection);
    const event = buildAgentTaskEvent(connection, credentials);
    const posted = await postAgentTaskReport(token, proxy, event);
    if (!posted.ok) return { ok: false, connectionId, status: posted.status, error: posted.error };
    return { ok: true, connectionId, status: posted.status };
  } catch (error) {
    return { ok: false, connectionId, error: error instanceof Error ? error.message : String(error) };
  }
}
