// CodeBuddy intl-cli daily probe scheduler. The local `autoclawTasks` table
// stores one `daily_probe` record per connection per day (the table schema is
// generic: connectionId + taskId + day). The probe runs a two-step daily
// growth pass:
//
// 1. Daily check-in claim (POST /billing/meter/daily-checkin) — claims the
//    free daily credit grant from the Tencent billing facade.
// 2. Activity report (POST /v2/report) — sends a chat_request_send event so
//    the account registers activity (login streak). Skipped when the check-in
//    step hard-fails, since reporting activity for an account whose
//    credential just died is noise.
//
// It runs every `intervalMinutes`
// (settings `codebuddyIntlCliDailyProbe.intervalMinutes`, default 60).
import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import { fetchDailyCheckin, type DailyCheckinResult } from "./codebuddyCheckin";
import { proxyAwareFetch } from "../common/proxyFetch";
import { registerScheduler, logSchedulerAction } from "../schedulerHistory";
import { refreshExpiringCredentials } from "./refreshCoordinator";
import { codebuddyRestrictedAt } from "./codebuddyRestricted";

const TASK_ID = "daily_probe";
const RESTRICTED_SKIP_MESSAGE = "Account restricted by CodeBuddy; token refreshed, check-in and report skipped.";
const PROVIDER_IDS = ["codebuddy-intl-cli"];
const DEFAULT_INTERVAL_MINUTES = 60;
const SETTINGS_KEY_CLI = "codebuddyIntlCliDailyProbe";
const REPORT_URL = "https://www.codebuddy.ai/v2/report";
const USER_AGENT = "CLI/2.154.0 CodeBuddy/2.154.0";

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;
let currentIntervalMinutes: number | null = null;

// The probe day follows the server's local calendar day. The scheduler ticks
// every intervalMinutes, but each tick only re-checks the day key — so the
// probe executes at most once per local day and re-arms when the local date
// rolls over, never once per tick.
export function codebuddyProbeDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface ResolvedProbe {
  credentials: Record<string, any>;
  proxy: Record<string, unknown> | undefined;
}

// Refresh credentials and resolve the token + proxy for a connection.
// Proxy resolution order: per-connection proxy → provider-level settings proxy → no proxy.
// Throws so callers can record the upstream error.
async function resolveProbe(runtime: Runtime, connection: ProviderConnection): Promise<ResolvedProbe> {
  const psd = resolveV1ProviderSpecificData(connection.data);
  let proxy = resolveConnectionProxyConfig(runtime, psd);
  
  // If no per-connection proxy is configured, check provider-level settings
  const hasPerConnectionProxy = proxy.connectionProxyEnabled || proxy.vercelRelayUrl;
  if (!hasPerConnectionProxy) {
    const settings = runtime.repos.settings.get() as Record<string, any>;
    const cliConfig = settings[SETTINGS_KEY_CLI] as { proxyPoolId?: string } | undefined;
    const settingsProxyPoolId = cliConfig?.proxyPoolId;
    
    if (settingsProxyPoolId) {
      // Merge settings proxy into providerSpecificData and re-resolve
      const psdWithSettingsProxy = { ...psd, proxyPoolId: settingsProxyPoolId };
      proxy = resolveConnectionProxyConfig(runtime, psdWithSettingsProxy);
    }
  }
  
  // Only pass proxy if actually configured (has a proxy URL or relay URL)
  // This allows tests to inject their own fetcher when no proxy is configured
  const hasActualProxy = proxy.connectionProxyEnabled || proxy.vercelRelayUrl;
  const effectiveProxy = hasActualProxy ? proxy : undefined;
  
  const credentials: Record<string, any> = { ...connection.data, authType: connection.authType, connectionId: connection.id, connectionName: connection.name || connection.id, providerSpecificData: { ...psd, ...proxy } };

  await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions: effectiveProxy ?? {} });
  const token = typeof credentials.accessToken === "string" && credentials.accessToken
    ? credentials.accessToken
    : typeof credentials.apiKey === "string" ? credentials.apiKey : "";
  if (!token) throw new Error("CodeBuddy credential not available.");
  return { credentials, proxy: effectiveProxy };
}

export interface CodebuddyProbeRun {
  ok: boolean;
  status: "completed" | "error";
  alreadyDone: boolean;
  error?: string;
  /** Daily check-in result from the credit claim step. */
  checkin: DailyCheckinResult | null;
  /** Whether the activity report step ran. */
  reported: boolean;
}

// Send a single chat_request_send report event to POST /v2/report. The event
// mimics what the CLI sends when a user starts a chat request. The report
// registers activity on the account without burning any model credits.
function buildReportEvent(credentials: Record<string, any>): Record<string, unknown> {
  const psd = credentials?.providerSpecificData && typeof credentials.providerSpecificData === "object" ? credentials.providerSpecificData : {};
  const uid = credentials?.codebuddyUserId || psd.codebuddyUserId || "";
  const now = Date.now();
  const conversationId = crypto.randomUUID();
  const requestId = conversationId.replace(/-/g, "");
  return {
    eventCode: "chat_request_send",
    timestamp: now,
    reportDelay: 0,
    mode: "unknown",
    conversationId,
    requestId,
    inputLength: 0,
    requestModelId: "default-model",
    requestModelName: "Auto",
    isPlan: false,
    isAutoExecuteTerminal: false,
    isAutoModify: false,
    codebaseEnable: false,
    maxToken: 0,
    maxSteps: 0,
    temperature: 0,
    maxRetries: 0,
    mentionContexts: [],
    knowledgeId: [],
    knowledgeName: [],
    codebaseId: "",
    mentionContextCount: 0,
    command: "",
    recommendId: "",
    skillId: "",
    skillCount: 0,
    totalCount: 0,
    presentAt: now,
    rootRequestId: requestId,
    parentConversationId: conversationId,
    agentName: "codebuddy",
    agentType: "main",
    product: "SaaS",
    userId: String(uid),
  };
}

export async function runCodebuddyProbeForConnection(runtime: Runtime, connectionId: string): Promise<CodebuddyProbeRun> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || !PROVIDER_IDS.includes(connection.provider)) {
    return { ok: false, status: "error", alreadyDone: false, error: "Connection not eligible for CodeBuddy probe.", checkin: null, reported: false };
  }

  // A restricted account only keeps its token fresh, so it still works once an
  // appeal succeeds. Check-in and the activity report would send more traffic
  // from a flagged account, so they are skipped and no daily record is written.
  if (codebuddyRestrictedAt(connection.data as Record<string, unknown>)) {
    try {
      await resolveProbe(runtime, connection);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, status: "error", alreadyDone: false, error: message, checkin: null, reported: false };
    }
    return { ok: false, status: "error", alreadyDone: false, error: RESTRICTED_SKIP_MESSAGE, checkin: null, reported: false };
  }

  const day = codebuddyProbeDayKey();
  const existing = runtime.repos.autoclawTasks.get(connectionId, TASK_ID, day);
  if (existing && existing.status === "completed") {
    const payload = existing.payload as { checkin?: DailyCheckinResult; report?: boolean } | null;
    return { ok: true, status: "completed", alreadyDone: true, checkin: payload?.checkin ?? null, reported: payload?.report === true };
  }

  let checkin: DailyCheckinResult | null = null;

  try {
    const { credentials, proxy } = await resolveProbe(runtime, connection);
    const token = typeof credentials.accessToken === "string" && credentials.accessToken
      ? credentials.accessToken
      : typeof credentials.apiKey === "string" ? credentials.apiKey : "";
    if (!token) throw new Error("CodeBuddy credential not available.");

    const psd = credentials?.providerSpecificData && typeof credentials.providerSpecificData === "object" ? credentials.providerSpecificData : {};
    const uid = credentials?.codebuddyUserId || psd.codebuddyUserId || "";

    // 1. Daily check-in claim — claims the free daily credit grant.
    //    Skipped silently if the credential is an opaque API key with no
    //    token (the check-in endpoint needs a bearer). The report leg below
    //    still fires so the account gets its login streak.
    try {
      checkin = await fetchDailyCheckin({ token, proxyOptions: proxy });
      console.log(`[codebuddy-probe] Check-in state: ${checkin.state}${checkin.credit !== null ? ` +${checkin.credit}` : ""}${checkin.streakDays !== null ? ` (streak ${checkin.streakDays})` : ""}`);
    } catch (error) {
      checkin = {
        state: "error",
        credit: null,
        streakDays: null,
        error: error instanceof Error ? error.message : "Daily check-in failed.",
      };
    }

    // If the check-in hard-failed, skip the report leg — reporting activity
    // for an account whose credential just died is noise.
    if (checkin.state === "error") {
      const checkinError = checkin.error ?? "Daily check-in failed.";
      runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "error", rewardPoints: 0, alreadyCompleted: false, error: checkinError, payload: { checkin, report: false } });
      return { ok: false, status: "error", alreadyDone: false, error: checkinError, checkin, reported: false };
    }

    // 2. Activity report — sends a chat_request_send event so the account
    //    registers activity (login streak).
    const event = buildReportEvent(credentials);
    const requestHeaders: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": USER_AGENT,
      "X-Domain": "www.codebuddy.ai",
      "X-Product": "SaaS",
      ...(uid ? { "X-User-Id": String(uid) } : { "X-No-User-Id": "1" }),
      Authorization: `Bearer ${token}`,
    };
    const requestBody = JSON.stringify([event]);
    const probeStartedAt = new Date().toISOString();
    console.log(`[codebuddy-probe] POST ${REPORT_URL}`);
    const response = await proxyAwareFetch(REPORT_URL, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
      signal: AbortSignal.timeout(30_000),
    }, proxy);

    const responseText = await response.text().catch(() => "");
    const probeEndedAt = new Date().toISOString();
    console.log(`[codebuddy-probe] Response status: ${response.status} ${response.statusText}`);

    const sanitizedHeaders = { ...requestHeaders };
    delete sanitizedHeaders.Authorization;

    const probeDetail = {
      url: REPORT_URL,
      method: "POST",
      requestHeaders: sanitizedHeaders,
      requestBody: JSON.parse(requestBody),
      responseStatus: response.status,
      responseStatusText: response.statusText,
      responseBody: responseText.slice(0, 2000),
      startedAt: probeStartedAt,
      endedAt: probeEndedAt,
    };

    if (!response.ok) {
      const suffix = responseText ? `: ${responseText.slice(0, 240)}` : "";
      throw new Error(`CodeBuddy report failed (status ${response.status})${suffix}.`);
    }

    runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "completed", rewardPoints: 0, alreadyCompleted: false, error: null, payload: { checkin, report: true, probe: probeDetail } });
    runtime.repos.usage.record({ provider: connection.provider, model: "report", connectionId, endpoint: "daily-probe", status: "success", promptTokens: 0, completionTokens: 0, meta: { dailyProbe: true } });
    return { ok: true, status: "completed", alreadyDone: false, checkin, reported: true };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "error", rewardPoints: 0, alreadyCompleted: false, error: message, payload: { checkin, report: false } });
    return { ok: false, status: "error", alreadyDone: false, error: message, checkin, reported: false };
  }
}

export interface CodebuddyProbeState {
  probed: boolean;
  day: string;
  error: string | null;
  /** Daily check-in result from the credit claim step, if the probe ran. */
  checkin: DailyCheckinResult | null;
  /** Whether the activity report step ran. */
  reported: boolean;
}

// Read today's probe flag from the local table. Reads never hit upstream.
export function readCodebuddyProbe(runtime: Runtime, connectionId: string): CodebuddyProbeState {
  const day = codebuddyProbeDayKey();
  const record = runtime.repos.autoclawTasks.get(connectionId, TASK_ID, day);
  const payload = record?.payload as { checkin?: DailyCheckinResult; report?: boolean } | null;
  return {
    probed: !!record && record.status === "completed",
    day,
    error: record?.error || null,
    checkin: payload?.checkin ?? null,
    reported: payload?.report === true,
  };
}

function probeConnections(runtime: Runtime): ProviderConnection[] {
  const connections: ProviderConnection[] = [];
  for (const pid of PROVIDER_IDS) {
    connections.push(...runtime.repos.providers.select(pid));
  }
  // Deduplicate by connection ID in case of overlap
  const seen = new Set<string>();
  return connections.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

function enabledIds(runtime: Runtime): Set<string> {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const cliConfig = settings[SETTINGS_KEY_CLI] as { connections?: Record<string, boolean> } | undefined;
  const cliMap = cliConfig?.connections || {};
  const ids = Object.entries(cliMap as Record<string, any>).filter(([, on]) => on === true).map(([id]) => id);
  return new Set(ids);
}

export async function runCodebuddyProbeTick(runtime: Runtime): Promise<void> {
  if (running) return;
  running = true;
  const startTime = Date.now();
  let count = 0;
  try {
    const enabled = enabledIds(runtime);
    for (const connection of probeConnections(runtime)) {
      if (enabled.has(connection.id)) {
        await runCodebuddyProbeForConnection(runtime, connection.id);
        count++;
      }
    }
  } finally {
    running = false;
    const durationMs = Date.now() - startTime;
    logSchedulerAction(
      "codebuddyProbe",
      "success",
      count > 0 ? `${count} account${count === 1 ? "" : "s"} probed` : "no accounts enabled",
      durationMs,
    );
  }
}

export function startCodebuddyProbe(runtime: Runtime): void {
  registerScheduler({
    id: "codebuddyProbe",
    name: "Daily Probe (CodeBuddy CLI)",
    description: "Daily check-in and activity report for CodeBuddy CLI accounts",
    interval: `${DEFAULT_INTERVAL_MINUTES} minutes`,
    enabled: true,
  });
  if (interval) return;
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const cliConfig = settings[SETTINGS_KEY_CLI] as { intervalMinutes?: number } | undefined;
  const minutes = Number(cliConfig?.intervalMinutes) || DEFAULT_INTERVAL_MINUTES;
  currentIntervalMinutes = minutes;
  void runCodebuddyProbeTick(runtime);
  interval = setInterval(() => { void runCodebuddyProbeTick(runtime); }, minutes * 60_000);
  interval.unref?.();
}

export function stopCodebuddyProbe(): void {
  if (interval) clearInterval(interval);
  interval = null;
  currentIntervalMinutes = null;
}

export function configureCodebuddyProbe(runtime: Runtime, settings: Record<string, any>): void {
  const cliConfig = settings[SETTINGS_KEY_CLI] as { intervalMinutes?: number } | undefined;
  const minutes = Number(cliConfig?.intervalMinutes) || DEFAULT_INTERVAL_MINUTES;
  const hasConnections = PROVIDER_IDS.some((pid) => runtime.repos.providers.select(pid).length > 0);
  if (!hasConnections) {
    stopCodebuddyProbe();
    return;
  }
  if (interval && currentIntervalMinutes === minutes) return;
  stopCodebuddyProbe();
  startCodebuddyProbe(runtime);
}

// Re-arm the scheduler after a CodeBuddy intl connection changes, so a new
// account probes immediately instead of waiting for the next tick.
export function onCodebuddyConnectionChanged(runtime: Runtime): void {
  configureCodebuddyProbe(runtime, runtime.repos.settings.get() as Record<string, any>);
}
