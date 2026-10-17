// AutoClaw daily check-in scheduler. The local `autoclawTasks` table is the
// source of truth for reads (the dashboard never fetches upstream directly).
// This background job keeps the local flag in sync with the upstream task list
// and, for connections with the auto-claim toggle on, claims `daily_signin`
// plus the one-time campaigns (fission login reward, inspiration cards).
// It runs every `intervalMinutes` (settings `autoclawAutoClaim.intervalMinutes`,
// default 60).
import type { Runtime } from "../../runtime";
import type { AutoclawTaskRecord, ProviderConnection } from "../../db/repositories";
import { resolveConnectionProxyConfig, resolveV1ProviderSpecificData } from "../chat/credentials";
import { claimAutoclawTask, claimFissionLoginReward, completeAutoclawInspiration, getAutoclawInspirations, getAutoclawTasks, normalizeInspirationLanguage, INSPIRATION_LANGUAGES, type AutoclawTask } from "./autoclawTasks";
import { registerScheduler, logSchedulerAction } from "../schedulerHistory";
import { refreshExpiringCredentials } from "../providers/refreshCoordinator";

const TASK_ID = "daily_signin";
const FISSION_TASK_ID = "fission_login_reward";
const INSPIRATION_TASK_ID = "inspiration_center";
const DEFAULT_INTERVAL_MINUTES = 60;
const SETTINGS_KEY = "autoclawAutoClaim";

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;
let currentIntervalMinutes: number | null = null;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const RESET_HOUR_WIB_MS = 1 * 60 * 60 * 1000;

// The AutoClaw check-in day rolls over at 01:00 WIB (UTC+7). The key is a UTC
// date so it never depends on the server's local timezone.
export function autoclawDayKey(now = new Date()): string {
  return new Date(now.getTime() - RESET_HOUR_WIB_MS + WIB_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export type AutoclawClaimId = "daily_signin" | "fission_login_reward" | "inspiration_center";

export interface AutoclawClaimDefinition {
  id: AutoclawClaimId;
  taskId: string;
  name: string;
}

// The claim types the dashboard exposes. `daily_signin` is discovered through
// the upstream task list (its display name comes from the task title);
// `fission_login_reward` and `inspiration_center` are one-time campaigns with
// fixed names.
export const AUTOCLAW_CLAIMS: AutoclawClaimDefinition[] = [
  { id: "daily_signin", taskId: TASK_ID, name: "Daily Login" },
  { id: "fission_login_reward", taskId: FISSION_TASK_ID, name: "Login Reward" },
  { id: "inspiration_center", taskId: INSPIRATION_TASK_ID, name: "Inspiration Center" },
];

interface ResolvedCredentials {
  accessToken: string;
  proxy: Record<string, unknown>;
}

interface ResolvedCheckIn {
  accessToken: string;
  proxy: Record<string, unknown>;
  task: AutoclawTask;
}

// Refresh credentials and resolve the access token + proxy for a connection.
// Throws so callers can surface the upstream error (or swallow it).
async function resolveCredentials(runtime: Runtime, connection: ProviderConnection): Promise<ResolvedCredentials> {
  const psd = resolveV1ProviderSpecificData(connection.data);
  const proxy = resolveConnectionProxyConfig(runtime, psd);
  const credentials: Record<string, any> = { ...connection.data, authType: connection.authType, connectionId: connection.id, connectionName: connection.name || connection.id, providerSpecificData: { ...psd, ...proxy } };

  await refreshExpiringCredentials(runtime, connection.id, credentials, { log: console, proxyOptions: proxy });
  const accessToken = typeof credentials.accessToken === "string" ? credentials.accessToken : "";
  if (!accessToken) throw new Error("AutoClaw access token not available.");
  return { accessToken, proxy };
}

// Refresh credentials and read today's `daily_signin` task. Throws so callers
// can surface the upstream error (or swallow it in the background sync).
async function resolveCheckIn(runtime: Runtime, connection: ProviderConnection): Promise<ResolvedCheckIn> {
  const { accessToken, proxy } = await resolveCredentials(runtime, connection);
  const tasks = await getAutoclawTasks(accessToken, proxy);
  const task = tasks.find((item) => item.task_id === TASK_ID);
  if (!task) throw new Error("Daily sign-in task not returned.");
  return { accessToken, proxy, task };
}

export interface AutoclawTaskRun {
  ok: boolean;
  status: "claimed" | "completed" | "error";
  rewardPoints: number;
  alreadyDone: boolean;
  error?: string;
}

export async function runAutoclawTaskForConnection(runtime: Runtime, connectionId: string): Promise<AutoclawTaskRun> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") {
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Connection not eligible for AutoClaw tasks." };
  }

  const day = autoclawDayKey();
  const existing = runtime.repos.autoclawTasks.get(connectionId, TASK_ID, day);
  if (existing && (existing.status === "claimed" || existing.status === "completed")) {
    return { ok: true, status: existing.status, rewardPoints: existing.rewardPoints, alreadyDone: true };
  }

  try {
    const { accessToken, proxy, task } = await resolveCheckIn(runtime, connection);

    if (task.status === "completed") {
      runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "completed", rewardPoints: Number(task.reward_points || 0), alreadyCompleted: false, error: null, payload: { title: task.title } });
      return { ok: true, status: "completed", rewardPoints: Number(task.reward_points || 0), alreadyDone: true };
    }

    const claim = await claimAutoclawTask(accessToken, TASK_ID, proxy);

    if (claim.already_completed) {
      runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "completed", rewardPoints: claim.reward_points, alreadyCompleted: true, error: null, payload: { title: task.title } });
      return { ok: true, status: "completed", rewardPoints: claim.reward_points, alreadyDone: true };
    }

    if (claim.success) {
      runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "claimed", rewardPoints: claim.reward_points, alreadyCompleted: false, error: null, payload: { title: task.title } });
      return { ok: true, status: "claimed", rewardPoints: claim.reward_points, alreadyDone: false };
    }

    runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "error", rewardPoints: 0, alreadyCompleted: false, error: "Claim was not successful." });
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Claim was not successful." };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "error", rewardPoints: 0, alreadyCompleted: false, error: message });
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: message };
  }
}

// Sync the local "checked in today" flag with the upstream task list without
// claiming. A check-in done from the web app (or elsewhere) reads as
// `completed` locally after this runs.
export async function syncAutoclawCheckIn(runtime: Runtime, connectionId: string): Promise<void> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") return;

  const day = autoclawDayKey();
  const existing = runtime.repos.autoclawTasks.get(connectionId, TASK_ID, day);
  if (existing && (existing.status === "claimed" || existing.status === "completed")) return;

  try {
    const { task } = await resolveCheckIn(runtime, connection);
    if (task.status === "completed") {
      runtime.repos.autoclawTasks.upsert({ connectionId, taskId: TASK_ID, day, status: "completed", rewardPoints: Number(task.reward_points || 0), alreadyCompleted: false, error: null, payload: { title: task.title } });
    }
  } catch {
    /* leave the local flag unchanged on upstream failure */
  }
}

function autoclawConnections(runtime: Runtime): ProviderConnection[] {
  return runtime.repos.providers.select("autoclaw");
}

// One-time campaigns (fission login reward, inspiration center) never roll
// over with the day key, unlike the daily sign-in. Their claimed state reads
// across all days instead of only today's record.
function claimedOneTimeRecord(runtime: Runtime, connectionId: string, taskId: string): AutoclawTaskRecord | null {
  return runtime.repos.autoclawTasks.listByConnection(connectionId)
    .find((record) => record.taskId === taskId && (record.status === "claimed" || record.status === "completed")) || null;
}

export async function runFissionLoginRewardForConnection(runtime: Runtime, connectionId: string): Promise<AutoclawTaskRun> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") {
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Connection not eligible for AutoClaw tasks." };
  }

  const day = autoclawDayKey();
  const existing = claimedOneTimeRecord(runtime, connectionId, FISSION_TASK_ID);
  if (existing) {
    return { ok: true, status: existing.status, rewardPoints: existing.rewardPoints, alreadyDone: true };
  }

  try {
    const { accessToken, proxy } = await resolveCredentials(runtime, connection);
    const claim = await claimFissionLoginReward(accessToken, proxy);
    const status = claim.alreadyRewarded ? "completed" : "claimed";
    runtime.repos.autoclawTasks.upsert({
      connectionId,
      taskId: FISSION_TASK_ID,
      day,
      status,
      rewardPoints: claim.rewardPoints,
      alreadyCompleted: claim.alreadyRewarded,
      error: null,
      payload: { reward: claim.reward || {} },
    });
    return { ok: true, status, rewardPoints: claim.rewardPoints, alreadyDone: claim.alreadyRewarded };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.repos.autoclawTasks.upsert({ connectionId, taskId: FISSION_TASK_ID, day, status: "error", rewardPoints: 0, alreadyCompleted: false, error: message });
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: message };
  }
}

export interface AutoclawInspirationItem {
  inspiration_id: string;
  title: string;
  reward_points: number;
  completed: boolean;
  done: boolean;
}

const INSPIRATION_ITEM_PREFIX = "inspiration:";

function inspirationItemTaskId(inspirationId: string): string {
  return `${INSPIRATION_ITEM_PREFIX}${inspirationId}`;
}

// Device id lives in connection data (top level or nested providerSpecificData).
// Fall back to a random id so the request body always carries one.
function resolveDeviceId(connection: ProviderConnection): string {
  const data = (connection.data || {}) as Record<string, any>;
  const nested = data.providerSpecificData as Record<string, any> | undefined;
  if (typeof data.deviceId === "string" && data.deviceId) return data.deviceId;
  if (nested && typeof nested.deviceId === "string" && nested.deviceId) return nested.deviceId;
  return crypto.randomUUID();
}

function isInspirationDone(runtime: Runtime, connectionId: string, item: { inspiration_id: string; completed: boolean }): boolean {
  if (item.completed) return true;
  const record = runtime.repos.autoclawTasks.listByConnection(connectionId)
    .find((candidate) => candidate.taskId === inspirationItemTaskId(item.inspiration_id) && (candidate.status === "claimed" || candidate.status === "completed"));
  return !!record;
}

function refreshInspirationAggregate(runtime: Runtime, connectionId: string, items: Array<{ inspiration_id: string; title: string; reward_points: number; completed: boolean }>, day: string, language: string): void {
  const taskId = inspirationAggregateTaskId(language);
  if (!items.length) return;
  // Drop the legacy unscoped aggregate from before language scoping.
  runtime.repos.autoclawTasks.removeTask(connectionId, INSPIRATION_TASK_ID);
  if (!items.every((item) => isInspirationDone(runtime, connectionId, item))) {
    runtime.repos.autoclawTasks.removeTask(connectionId, taskId);
    return;
  }
  const rewardPoints = items.reduce((sum, item) => sum + (Number(item.reward_points) || 0), 0);
  runtime.repos.autoclawTasks.upsert({ connectionId, taskId, day, status: "completed", rewardPoints, alreadyCompleted: false, error: null, payload: { total: items.length, language } });
}

function inspirationAggregateTaskId(language: string): string {
  return `${INSPIRATION_TASK_ID}:${normalizeInspirationLanguage(language)}`;
}

// The claims row reads every language aggregate: claimed when any language
// finished, points summed across finished languages.
function readInspirationAggregate(runtime: Runtime, connectionId: string): { claimed: boolean; rewardPoints: number } {
  const records = runtime.repos.autoclawTasks.listByConnection(connectionId)
    .filter((record) => record.taskId.startsWith(`${INSPIRATION_TASK_ID}:`) && (record.status === "claimed" || record.status === "completed"));
  return {
    claimed: records.length > 0,
    rewardPoints: records.reduce((sum, record) => sum + record.rewardPoints, 0),
  };
}

// List upstream cards merged with local flags. Opening the list checks status:
// cards completed upstream sync to done, cards still false revert a stale
// local done, so later claims only try what upstream still shows as pending.
export async function listInspirationCenter(runtime: Runtime, connectionId: string, languageRaw: unknown = "id"): Promise<AutoclawInspirationItem[]> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") throw new Error("Connection not eligible for AutoClaw tasks.");
  const day = autoclawDayKey();
  const language = normalizeInspirationLanguage(languageRaw);
  const { accessToken, proxy } = await resolveCredentials(runtime, connection);
  const items = await getAutoclawInspirations(accessToken, resolveDeviceId(connection), language, proxy);
  for (const item of items) {
    const taskId = inspirationItemTaskId(item.inspiration_id);
    if (item.completed) {
      if (!isInspirationDone(runtime, connectionId, item)) {
        runtime.repos.autoclawTasks.upsert({ connectionId, taskId, day, status: "completed", rewardPoints: item.reward_points, alreadyCompleted: true, error: null, payload: { title: item.title } });
      }
    } else {
      runtime.repos.autoclawTasks.removeTask(connectionId, taskId);
    }
  }
  refreshInspirationAggregate(runtime, connectionId, items, day, language);
  return items.map((item) => ({
    inspiration_id: item.inspiration_id,
    title: item.title,
    reward_points: item.reward_points,
    completed: item.completed,
    done: isInspirationDone(runtime, connectionId, item),
  }));
}

export async function runInspirationItemForConnection(runtime: Runtime, connectionId: string, inspirationId: string, languageRaw: unknown = "id"): Promise<AutoclawTaskRun> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") {
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Connection not eligible for AutoClaw tasks." };
  }
  if (!inspirationId) {
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Unknown inspiration." };
  }

  const day = autoclawDayKey();
  const language = normalizeInspirationLanguage(languageRaw);
  try {
    const { accessToken, proxy } = await resolveCredentials(runtime, connection);
    const items = await getAutoclawInspirations(accessToken, resolveDeviceId(connection), language, proxy);
    const item = items.find((candidate) => candidate.inspiration_id === inspirationId);
    if (!item) {
      return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Unknown inspiration." };
    }
    if (isInspirationDone(runtime, connectionId, item)) {
      runtime.repos.autoclawTasks.upsert({ connectionId, taskId: inspirationItemTaskId(item.inspiration_id), day, status: "completed", rewardPoints: item.reward_points, alreadyCompleted: true, error: null, payload: { title: item.title } });
      refreshInspirationAggregate(runtime, connectionId, items, day, language);
      return { ok: true, status: "completed", rewardPoints: item.reward_points, alreadyDone: true };
    }

    const claim = await completeAndRecordInspiration(runtime, connection, accessToken, proxy, item, day);
    refreshInspirationAggregate(runtime, connectionId, items, day, language);
    return { ok: true, status: "completed", rewardPoints: item.reward_points, alreadyDone: claim.alreadyCompleted };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: message };
  }
}

interface InspirationCard {
  inspiration_id: string;
  title: string;
  reward_points: number;
}

// Complete one card upstream and record it locally. Throws on failure so
// callers can retry only the remaining cards.
async function completeAndRecordInspiration(
  runtime: Runtime,
  connection: ProviderConnection,
  accessToken: string,
  proxy: Record<string, unknown>,
  item: InspirationCard,
  day: string,
): Promise<{ alreadyCompleted: boolean }> {
  const claim = await completeAutoclawInspiration(accessToken, item.inspiration_id, proxy);
  runtime.repos.autoclawTasks.upsert({ connectionId: connection.id, taskId: inspirationItemTaskId(item.inspiration_id), day, status: "completed", rewardPoints: item.reward_points, alreadyCompleted: claim.alreadyCompleted, error: null, payload: { title: item.title } });
  return claim;
}

export async function runInspirationCenterForConnection(runtime: Runtime, connectionId: string, languageRaw: unknown = "id"): Promise<AutoclawTaskRun> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") {
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Connection not eligible for AutoClaw tasks." };
  }

  const day = autoclawDayKey();
  const language = normalizeInspirationLanguage(languageRaw);
  const existing = claimedOneTimeRecord(runtime, connectionId, inspirationAggregateTaskId(language));
  if (existing) {
    return { ok: true, status: existing.status, rewardPoints: existing.rewardPoints, alreadyDone: true };
  }

  try {
    const { accessToken, proxy } = await resolveCredentials(runtime, connection);
    const items = await getAutoclawInspirations(accessToken, resolveDeviceId(connection), language, proxy);
    const pending = items.filter((item) => !isInspirationDone(runtime, connectionId, item));
    if (!pending.length) {
      refreshInspirationAggregate(runtime, connectionId, items, day, language);
      const aggregate = claimedOneTimeRecord(runtime, connectionId, inspirationAggregateTaskId(language));
      return { ok: true, status: "completed", rewardPoints: aggregate?.rewardPoints || 0, alreadyDone: true };
    }

    // Complete each pending card by id. Each accepted call flips its card.
    // A failed card keeps no local flag, so a retry only attempts the rest.
    for (const item of pending) {
      await completeAndRecordInspiration(runtime, connection, accessToken, proxy, item, day);
    }

    const rewardPoints = pending.reduce((sum, item) => sum + item.reward_points, 0);
    refreshInspirationAggregate(runtime, connectionId, items, day, language);
    return { ok: true, status: "completed", rewardPoints, alreadyDone: false };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: message };
  }
}

// Claim every pending inspiration card in every language for one connection.
// Each language short-circuits locally when finished, so steady state costs
// one list fetch per language. Failures never throw, so bulk callers stay alive.
export async function runInspirationAllLanguagesForConnection(runtime: Runtime, connectionId: string): Promise<AutoclawTaskRun> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") {
    return { ok: false, status: "error", rewardPoints: 0, alreadyDone: false, error: "Connection not eligible for AutoClaw tasks." };
  }
  let rewardPoints = 0;
  let alreadyDone = true;
  let failed = 0;
  let lastError: string | undefined;
  for (const language of INSPIRATION_LANGUAGES) {
    const result = await runInspirationCenterForConnection(runtime, connectionId, language);
    if (result.ok) {
      rewardPoints += result.rewardPoints || 0;
      if (!result.alreadyDone) alreadyDone = false;
    } else {
      failed += 1;
      alreadyDone = false;
      if (result.error) lastError = result.error;
    }
  }
  if (failed === 0) {
    return { ok: true, status: "completed", rewardPoints, alreadyDone };
  }
  return {
    ok: false,
    status: "error",
    rewardPoints,
    alreadyDone: false,
    error: lastError || `${failed} language(s) failed.`,
  };
}

// Run the one-time campaigns for one connection: the fission login reward
// plus every pending inspiration card in every language. Finished campaigns
// short-circuit locally, so steady state costs one list fetch per language.
// Failures never throw, so the shared tick stays alive.
export async function runOneTimeTasksForConnection(runtime: Runtime, connectionId: string): Promise<void> {
  const connection = runtime.repos.providers.get(connectionId);
  if (!connection || connection.provider !== "autoclaw") return;
  try {
    await runFissionLoginRewardForConnection(runtime, connectionId);
  } catch { /* fission must never break the tick */ }
  const day = autoclawDayKey();
  for (const language of INSPIRATION_LANGUAGES) {
    try {
      const items = await listInspirationCenter(runtime, connectionId, language);
      const pending = items.filter((item) => !item.done);
      if (!pending.length) continue;
      const { accessToken, proxy } = await resolveCredentials(runtime, connection);
      for (const item of pending) {
        await completeAndRecordInspiration(runtime, connection, accessToken, proxy, item, day);
      }
      refreshInspirationAggregate(runtime, connectionId, items, day, language);
    } catch { /* next language */ }
  }
}

export interface AutoclawClaimResult {
  id: AutoclawClaimId;
  ok: boolean;
  status: "claimed" | "completed" | "error";
  rewardPoints: number;
  alreadyDone: boolean;
  error?: string;
}

export async function runAutoclawClaimForConnection(runtime: Runtime, connectionId: string, claimId: AutoclawClaimId): Promise<AutoclawClaimResult> {
  const result = claimId === "fission_login_reward"
    ? await runFissionLoginRewardForConnection(runtime, connectionId)
    : claimId === "inspiration_center"
      ? await runInspirationCenterForConnection(runtime, connectionId)
      : await runAutoclawTaskForConnection(runtime, connectionId);
  return { id: claimId, ...result };
}

export interface AutoclawClaimState {
  id: AutoclawClaimId;
  name: string;
  claimed: boolean;
  rewardPoints: number;
}

export function readAutoclawClaims(runtime: Runtime, connectionId: string): AutoclawClaimState[] {
  const day = autoclawDayKey();
  return AUTOCLAW_CLAIMS.map((definition) => {
    if (definition.id === "inspiration_center") {
      const aggregate = readInspirationAggregate(runtime, connectionId);
      return {
        id: definition.id,
        name: definition.name,
        claimed: aggregate.claimed,
        rewardPoints: aggregate.rewardPoints,
      };
    }
    const record = definition.id === "daily_signin"
      ? runtime.repos.autoclawTasks.get(connectionId, definition.taskId, day)
      : claimedOneTimeRecord(runtime, connectionId, definition.taskId);
    const claimed = !!record && (record.status === "claimed" || record.status === "completed");
    const title = record && typeof record.payload?.title === "string" && record.payload.title ? record.payload.title : "";
    return {
      id: definition.id,
      name: definition.id === "daily_signin" && title ? title : definition.name,
      claimed,
      rewardPoints: record ? record.rewardPoints : 0,
    };
  });
}

function enabledIds(runtime: Runtime): Set<string> {
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const config = settings[SETTINGS_KEY] as { connections?: Record<string, boolean> } | undefined;
  const enabledMap = config?.connections || {};
  return new Set(Object.entries(enabledMap as Record<string, any>).filter(([, on]) => on === true).map(([id]) => id));
}

export async function runAutoclawTasksTick(runtime: Runtime): Promise<void> {
  if (running) return;
  running = true;
  const startTime = Date.now();
  let count = 0;
  try {
    const enabled = enabledIds(runtime);
    for (const connection of autoclawConnections(runtime)) {
      if (enabled.has(connection.id)) {
        await runAutoclawTaskForConnection(runtime, connection.id);
        await runOneTimeTasksForConnection(runtime, connection.id);
        count++;
      } else {
        await syncAutoclawCheckIn(runtime, connection.id);
      }
    }
  } finally {
    running = false;
    const durationMs = Date.now() - startTime;
    logSchedulerAction(
      "autoclawTasks",
      "success",
      count > 0 ? `${count} account${count === 1 ? "" : "s"} processed` : "no accounts enabled",
      durationMs,
    );
  }
}

export function startAutoclawTasks(runtime: Runtime): void {
  registerScheduler({
    id: "autoclawTasks",
    name: "Daily Check-in",
    description: "Claims daily rewards for Autoclaw accounts",
    interval: `${DEFAULT_INTERVAL_MINUTES} minutes`,
    enabled: true,
  });
  if (interval) return;
  const settings = runtime.repos.settings.get() as Record<string, any>;
  const config = settings[SETTINGS_KEY] as { intervalMinutes?: number } | undefined;
  const minutes = Number(config?.intervalMinutes) || DEFAULT_INTERVAL_MINUTES;
  currentIntervalMinutes = minutes;
  void runAutoclawTasksTick(runtime);
  interval = setInterval(() => { void runAutoclawTasksTick(runtime); }, minutes * 60_000);
  interval.unref?.();
}

export function stopAutoclawTasks(): void {
  if (interval) clearInterval(interval);
  interval = null;
  currentIntervalMinutes = null;
}

export function configureAutoclawTasks(runtime: Runtime, settings: Record<string, any>): void {
  const config = settings[SETTINGS_KEY] as { intervalMinutes?: number } | undefined;
  const minutes = Number(config?.intervalMinutes) || DEFAULT_INTERVAL_MINUTES;
  const hasConnections = runtime.repos.providers.select("autoclaw").length > 0;
  if (!hasConnections) {
    stopAutoclawTasks();
    return;
  }
  if (interval && currentIntervalMinutes === minutes) return;
  stopAutoclawTasks();
  startAutoclawTasks(runtime);
}

// Re-arm the scheduler after an AutoClaw connection is created or re-enabled so
// a brand-new account is picked up immediately instead of waiting for the next
// tick (or never, if the scheduler was stopped for lack of connections).
export function onAutoclawConnectionChanged(runtime: Runtime, connectionId: string): void {
  configureAutoclawTasks(runtime, runtime.repos.settings.get() as Record<string, any>);
  void syncAutoclawCheckIn(runtime, connectionId);
}
