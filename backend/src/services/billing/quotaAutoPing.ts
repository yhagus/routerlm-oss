import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { getV2Executor } from "../chat/executors";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage } from "./usage/codex.js";
import { proxyAwareFetch } from "../common/proxyFetch.ts";
import { CLAUDE_CLI_SPOOF_HEADERS } from "../providers/registryShared.ts";
import { registerScheduler, logSchedulerAction } from "../schedulerHistory";
import { refreshExpiringCredentials } from "../providers/refreshCoordinator";
import { providerSpecificPatch } from "../providers/providerSpecificPatch";

const PROVIDERS = {
  claude: { settingsKey: "claudeAutoPing", quotaKey: "session (5h)", pingModel: "claude-haiku-4-5-20251001", pingText: "hi", pingMaxTokens: 1 },
  codex: { settingsKey: "codexAutoPing", quotaKey: "session", pingWhenResetAtSlides: true, resetAtDriftMs: 30_000, minPingIntervalMs: 600_000, skipWhenBlockingQuotaExhausted: true, pingModel: "gpt-5.5", pingText: "hi" },
} as const;
const TICK_MS = 60_000, PING_LEAD_MS = 5_000, REFRESH_AHEAD_MS = 300_000, FAILURE_COOLDOWN_MS = 900_000;
let interval: ReturnType<typeof setInterval> | null = null;
let running = false;
const resets = new Map<string, string>();
const failures = new Map<string, number>();
const key = (provider: string, id: string) => `${provider}:${id}`;
const finite = (value: unknown) => typeof value === "number" ? value : Number(value);
const exhausted = (quota: any) => quota && quota.unlimited !== true && ((Number.isFinite(finite(quota.remaining)) && finite(quota.remaining) <= 0) || (finite(quota.total) > 0 && finite(quota.used) >= finite(quota.total)));
const resetKey = (value: string) => { const ms = new Date(value).getTime(); return Number.isFinite(ms) ? new Date(Math.floor(ms / 60_000) * 60_000).toISOString() : value; };
async function ping(runtime: Runtime, provider: "claude" | "codex", connection: ProviderConnection, config: typeof PROVIDERS["claude"] | typeof PROVIDERS["codex"], credentials: Record<string, any>, proxy: Record<string, any>) {
  if (provider === "claude") return (await proxyAwareFetch("https://api.anthropic.com/v1/messages?beta=true", { method: "POST", headers: { ...CLAUDE_CLI_SPOOF_HEADERS, Authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ model: config.pingModel, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }) }, proxy)).ok;
  const executor = getV2Executor("codex"); if (!executor) return false;
  const result = await executor.execute({ model: "gpt-5.5", stream: true, credentials, proxyOptions: proxy, log: console, body: { model: "gpt-5.5", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }], instructions: "Reply with OK.", reasoning: { effort: "none", summary: "auto" }, store: false, stream: true } });
  if (result.response.ok) await result.response.text().catch(() => {}); else await result.response.body?.cancel?.().catch(() => {});
  return result.response.ok;
}
export async function runQuotaAutoPingTick(runtime: Runtime) {
  if (running) return; running = true;
  const startTime = Date.now();
  let pingCount = 0;
  let failCount = 0;
  try { const settings = runtime.repos.settings.get() as Record<string, any>;
    for (const [provider, config] of Object.entries(PROVIDERS as Record<string, any>) as Array<["claude" | "codex", any]>) {
      const enabled = settings[config.settingsKey]?.connections || {}; if (!Object.values(enabled).some(Boolean)) continue;
      for (const connection of runtime.repos.providers.select(provider).filter((item) => item.authType === "oauth" && enabled[item.id] === true)) {
        const cache = key(provider, connection.id), now = Date.now(); if (failures.get(cache) && now - failures.get(cache)! < FAILURE_COOLDOWN_MS) continue;
        const psd = resolveV1ProviderSpecificData(connection.data), proxy = resolveConnectionProxyConfig(runtime, psd), credentials: Record<string, any> = { ...connection.data, connectionId: connection.id, providerSpecificData: { ...psd, ...proxy } };
        try { await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions: proxy }); const usage = provider === "claude" ? await getClaudeUsage(credentials.accessToken, proxy) : await getCodexUsage(credentials.accessToken, proxy); const quotas = usage?.quotas || {}, quota = quotas[config.quotaKey], resetAt = quota?.resetAt; if (!resetAt || exhausted(quota)) continue;
          const resetValue = String(resetAt), previous = resets.get(cache); resets.set(cache, resetValue); const trigger = config.pingWhenResetAtSlides ? Boolean(previous) && new Date(resetValue).getTime() - new Date(String(previous)).getTime() >= config.resetAtDriftMs : now >= new Date(resetValue).getTime() - PING_LEAD_MS;
          const last = new Date(String(connection.data.lastPingAt || "")).getTime(), pinged = String(connection.data.lastPingedResetKey || resetKey(String(connection.data.lastPingedResetAt || ""))); if (!trigger || (config.minPingIntervalMs && Number.isFinite(last) && now - last < config.minPingIntervalMs) || pinged === resetKey(resetValue)) continue;
          if (await ping(runtime, provider, connection, config, credentials, proxy)) { runtime.repos.providers.patch(connection.id, { data: providerSpecificPatch(runtime.repos.providers.get(connection.id), { lastPingedResetAt: resetValue, lastPingedResetKey: resetKey(resetValue), lastPingAt: new Date().toISOString() }) }); pingCount++; } else { failures.set(cache, now); failCount++; }
        } catch { failures.set(cache, now); failCount++; }
      }
    }
  } finally {
    running = false;
    const durationMs = Date.now() - startTime;
    logSchedulerAction(
      "quotaAutoPing",
      failCount > 0 ? "failure" : "success",
      pingCount > 0 ? `${pingCount} pinged` : failCount > 0 ? `${failCount} failed` : "no pings needed",
      durationMs,
    );
  }
}
export function startQuotaAutoPing(runtime: Runtime) {
  registerScheduler({
    id: "quotaAutoPing",
    name: "Quota Auto Ping",
    description: "Automatically pings quota endpoints to refresh limits",
    interval: "1 minute",
    enabled: true,
  });
  if (interval) return; void runQuotaAutoPingTick(runtime); interval = setInterval(() => void runQuotaAutoPingTick(runtime), TICK_MS); interval.unref?.();
}
export function stopQuotaAutoPing() { if (interval) clearInterval(interval); interval = null; resets.clear(); failures.clear(); }
export function configureQuotaAutoPing(runtime: Runtime, settings: Record<string, any>): void {
  const enabled = Object.values(PROVIDERS).some((config) => Object.values(settings?.[config.settingsKey]?.connections || {}).some(Boolean));
  if (enabled) startQuotaAutoPing(runtime); else stopQuotaAutoPing();
}
