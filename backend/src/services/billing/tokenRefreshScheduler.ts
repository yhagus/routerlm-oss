// Proactive token refresh scheduler. Iterates all active OAuth connections every
// TICK_MS and refreshes tokens that are near expiry (expiresAt - now < refreshLeadMs)
// or stale (maxRefreshAgeMs exceeded). Refreshes go through the refresh
// coordinator, so a tick never duplicates a refresh that a request started.
import type { Runtime } from "../../runtime";
import type { ProviderConnection } from "../../db/repositories";
import { getV2Executor } from "../chat/executors";
import { connectionCredentials } from "../chat/credentials";
import { shouldRefreshCredentials } from "../providers/oauth/oauthCredentialManager.ts";
import { refreshConnectionCredentials } from "../providers/refreshCoordinator";
import { registerScheduler, logSchedulerAction } from "../schedulerHistory";

const TICK_MS = 2 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;
const failures = new Map<string, number>();
const key = (provider: string, id: string) => `${provider}:${id}`;

async function refreshConnection(runtime: Runtime, connection: ProviderConnection): Promise<void> {
  const executor = getV2Executor(connection.provider);
  if (!executor?.refreshCredentials) return;
  const credentials = connectionCredentials(runtime, connection);
  if (!shouldRefreshCredentials(connection.provider, credentials)) return;

  const outcome = await refreshConnectionCredentials(runtime, connection.id, { log: console });
  if (!outcome) throw new Error("token refresh failed");
  if (outcome.refreshed) console.log(`[token-refresh] Refreshed token for ${connection.provider}:${connection.id}`);
}

export async function runTokenRefreshTick(runtime: Runtime): Promise<void> {
  if (running) return;
  running = true;
  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;
  try {
    const now = Date.now();
    const connections = runtime.repos.providers.list(true).filter(
      (connection) =>
        connection.isActive !== false &&
        connection.authType === "oauth" &&
        connection.data?.refreshToken,
    );
    for (const connection of connections) {
      const cacheKey = key(connection.provider, connection.id);
      const failedAt = failures.get(cacheKey);
      if (failedAt && now - failedAt < FAILURE_COOLDOWN_MS) continue;
      try {
        await refreshConnection(runtime, connection);
        failures.delete(cacheKey);
        successCount++;
      } catch (error: any) {
        console.error(`[token-refresh] Failed to refresh ${connection.provider}:${connection.id}: ${error instanceof Error ? error.message : String(error)}`);
        failures.set(cacheKey, now);
        failCount++;
      }
    }
  } finally {
    running = false;
    const durationMs = Date.now() - startTime;
    logSchedulerAction(
      "tokenRefresh",
      failCount > 0 ? "failure" : "success",
      failCount > 0 ? `${failCount} failed, ${successCount} succeeded` : `${successCount} refreshed`,
      durationMs,
    );
  }
}

export function startTokenRefreshScheduler(runtime: Runtime): void {
  registerScheduler({
    id: "tokenRefresh",
    name: "Token Refresh",
    description: "Refreshes OAuth tokens before they expire",
    interval: "2 minutes",
    enabled: true,
  });
  if (interval) return;
  void runTokenRefreshTick(runtime);
  interval = setInterval(() => void runTokenRefreshTick(runtime), TICK_MS);
  interval.unref?.();
}

export function stopTokenRefreshScheduler(): void {
  if (interval) clearInterval(interval);
  interval = null;
  failures.clear();
}
