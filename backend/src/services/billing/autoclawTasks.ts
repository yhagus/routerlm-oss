// AutoClaw daily-activity task list + claim. The upstream exposes a task list
// (currently only `daily_signin` is acted on) and a task-complete endpoint that
// mints reward points once per day. These web endpoints use the standard
// `Authorization` bearer header (not the chat proxy's X-Authorization) plus the
// app-signed web-client headers (client-type/tm `web`, version 1.12.1).
import { createHash, randomUUID } from "node:crypto";
import { APP_ID, APP_KEY } from "../chat/autoclawExecutor";
import { proxyAwareFetch } from "../common/proxyFetch.ts";

const TASK_LIST_URL =
  "https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw-task-list?lang=en";
const TASK_COMPLETE_URL =
  "https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw-task-complete";
const FISSION_REWARD_URL =
  "https://autoglm-api.autoglm.ai/agent-assetmgr/api/v1/fission-v2/login-reward";
const FISSION_ACTIVITY_ID = "fission_login_bind_assist_260831";
const INSPIRATION_CENTER_URL =
  "https://autoglm-api.autoglm.ai/agentdr/v1/assistant/inspiration-center";
const INSPIRATION_COMPLETE_URL =
  "https://autoglm-api.autoglm.ai/agentdr/v1/assistant/inspiration-task-complete";
const WEB_VERSION = "1.12.1";

export interface AutoclawTask {
  task_id: string;
  title: string;
  reward_points: number;
  status: "incomplete" | "completed" | string;
  status_description?: string;
  current_count?: number;
  target_count?: number;
  [key: string]: unknown;
}

export interface AutoclawClaimResult {
  task_id: string;
  success: boolean;
  reward_points: number;
  already_completed: boolean;
}

export interface FissionLoginReward {
  activity_id: string;
  business: string;
  status: string;
  already_rewarded: boolean;
  reward_amount: number;
  reward_currency: string;
  effective_at?: number;
  expires_at?: number;
  valid_days?: number;
  wallet_type?: string;
  wallet_scope?: string;
  wallet_id?: string;
  ledger_entry_id?: string;
  experiment_key?: string;
  experiment_strategy?: string;
  server_time?: number;
  [key: string]: unknown;
}

export interface FissionClaimResult {
  success: boolean;
  alreadyRewarded: boolean;
  rewardPoints: number;
  reward: FissionLoginReward | null;
}

function bearerToken(accessToken: string): string {
  return accessToken.replace(/^Bearer\s+/i, "").trim();
}

function taskHeaders(accessToken: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = createHash("md5")
    .update(`${APP_ID}&${ts}&${APP_KEY}`)
    .digest("hex");
  return {
    accept: "*/*",
    "content-type": "application/json",
    authorization: `Bearer ${bearerToken(accessToken)}`,
    origin: "https://autoclaw.z.ai",
    referer: "https://autoclaw.z.ai/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "x-auth-appid": APP_ID,
    "x-auth-sign": sign,
    "x-auth-timestamp": ts,
    "x-channel": "official",
    "x-client-type": "web",
    "x-lang": "en",
    "x-product": "autoclaw",
    "x-tm": "web",
    "x-trace-id": crypto.randomUUID(),
    "x-version": WEB_VERSION,
  };
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return `status ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}

export async function getAutoclawTasks(
  accessToken: string,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<AutoclawTask[]> {
  const token = bearerToken(accessToken);
  if (!token) return [];
  const response = await proxyAwareFetch(
    TASK_LIST_URL,
    {
      method: "GET",
      headers: taskHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
    proxyOptions,
  );
  if (!response.ok) throw new Error(`AutoClaw task list failed (${await readError(response)})`);
  const data = (await response.json().catch(() => null)) as
    | { data?: AutoclawTask[] }
    | null;
  if (Array.isArray(data?.data)) return data.data;
  throw new Error(`AutoClaw task list returned an unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
}

export async function claimAutoclawTask(
  accessToken: string,
  taskId: string,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<AutoclawClaimResult> {
  const token = bearerToken(accessToken);
  if (!token || !taskId) throw new Error("AutoClaw claim requires an access token and task id.");
  const response = await proxyAwareFetch(
    TASK_COMPLETE_URL,
    {
      method: "POST",
      headers: taskHeaders(token),
      body: JSON.stringify({ task_id: taskId }),
      signal: AbortSignal.timeout(30_000),
    },
    proxyOptions,
  );
  if (!response.ok) throw new Error(`AutoClaw claim failed (${await readError(response)})`);
  const data = (await response.json().catch(() => null)) as
    | { data?: Partial<AutoclawClaimResult>; error?: string }
    | null;
  if (data?.error) throw new Error(`AutoClaw claim rejected: ${data.error}`);
  if (!data?.data) throw new Error(`AutoClaw claim returned an unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  return {
    task_id: String(data.data.task_id || taskId),
    success: data.data.success === true,
    reward_points: Number(data.data.reward_points || 0),
    already_completed: data.data.already_completed === true,
  };
}

export async function claimFissionLoginReward(
  accessToken: string,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<FissionClaimResult> {
  const token = bearerToken(accessToken);
  if (!token) throw new Error("Fission login reward requires an access token.");
  const response = await proxyAwareFetch(
    FISSION_REWARD_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source_id: "web",
        activity_id: FISSION_ACTIVITY_ID,
        business: "autoclaw",
      }),
      signal: AbortSignal.timeout(30_000),
    },
    proxyOptions,
  );
  if (!response.ok) throw new Error(`Fission login reward failed (${await readError(response)})`);
  const data = (await response.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: { login_reward?: Partial<FissionLoginReward> } }
    | null;
  if (data?.code !== 0) {
    const message = typeof data?.msg === "string" && data.msg ? data.msg : JSON.stringify(data).slice(0, 200);
    throw new Error(`Fission login reward rejected: ${message}`);
  }
  const reward = (data?.data?.login_reward as FissionLoginReward | undefined) || null;
  if (!reward) throw new Error(`Fission login reward returned an unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  return {
    success: true,
    alreadyRewarded: reward.already_rewarded === true,
    rewardPoints: Number(reward.reward_amount || 0),
    reward,
  };
}

export interface AutoclawInspiration {
  inspiration_id: string;
  title: string;
  reward_points: number;
  prompt: string;
  completed: boolean;
}

// One-time inspiration-center campaign. The upstream lists prompt cards; each
// card carries its reward and its trigger prompt inside
// action_config.button.prompt. Cards already marked completed need no probe.
// The list endpoint needs the account device id plus source and language.
// Card ids differ per language, so callers scope records by language too.
export const INSPIRATION_LANGUAGES = ["en", "zh-CN", "ja", "ko", "es", "ru", "pt-BR", "id", "hi", "ar", "tr"] as const;

export function normalizeInspirationLanguage(value: unknown): string {
  const language = typeof value === "string" ? value.trim() : "";
  return (INSPIRATION_LANGUAGES as readonly string[]).includes(language) ? language : "id";
}

export async function getAutoclawInspirations(
  accessToken: string,
  deviceId: string,
  language: string,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<AutoclawInspiration[]> {
  const token = bearerToken(accessToken);
  if (!token) return [];
  const lang = normalizeInspirationLanguage(language);
  const response = await proxyAwareFetch(
    INSPIRATION_CENTER_URL,
    {
      method: "POST",
      // The center filters cards by header language, not only body language.
      // The web client sends the list language here (task list uses en).
      headers: { ...taskHeaders(token), "x-lang": lang },
      body: JSON.stringify({
        source_id: "autoclaw",
        device_id: deviceId || randomUUID(),
        language: lang,
      }),
      signal: AbortSignal.timeout(30_000),
    },
    proxyOptions,
  );
  if (!response.ok) throw new Error(`AutoClaw inspiration list failed (${await readError(response)})`);
  const data = (await response.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: { list?: Array<Record<string, unknown>> } }
    | null;
  if (data?.code !== 0 || !Array.isArray(data?.data?.list)) {
    const message = typeof data?.msg === "string" && data.msg ? data.msg : JSON.stringify(data).slice(0, 200);
    throw new Error(`AutoClaw inspiration list rejected: ${message}`);
  }
  const items: AutoclawInspiration[] = [];
  for (const raw of data.data.list) {
    let prompt = "";
    try {
      const config = JSON.parse(String(raw.action_config || "{}")) as { button?: { prompt?: unknown } };
      prompt = typeof config?.button?.prompt === "string" ? config.button.prompt : "";
    } catch {
      prompt = "";
    }
    if (!prompt) continue;
    items.push({
      inspiration_id: String(raw.inspiration_id || ""),
      title: typeof raw.title === "string" ? raw.title : "",
      reward_points: Number(raw.reward_points) || 0,
      prompt,
      completed: raw.completed === true,
    });
  }
  return items;
}

export interface AutoclawInspirationComplete {
  success: boolean;
  alreadyCompleted: boolean;
}

// Complete one inspiration card by id. The upstream flips the card and
// mints its reward. An already-completed card reports success as done.
export async function completeAutoclawInspiration(
  accessToken: string,
  inspirationId: string,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<AutoclawInspirationComplete> {
  const token = bearerToken(accessToken);
  if (!token || !inspirationId) throw new Error("AutoClaw inspiration complete requires an access token and inspiration id.");
  const response = await proxyAwareFetch(
    INSPIRATION_COMPLETE_URL,
    {
      method: "POST",
      headers: taskHeaders(token),
      body: JSON.stringify({ inspiration_id: inspirationId }),
      signal: AbortSignal.timeout(30_000),
    },
    proxyOptions,
  );
  if (!response.ok) throw new Error(`AutoClaw inspiration complete failed (${await readError(response)})`);
  const data = (await response.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: Record<string, unknown> }
    | null;
  if (data?.code === 0) return { success: true, alreadyCompleted: false };
  const message = typeof data?.msg === "string" && data.msg ? data.msg : JSON.stringify(data).slice(0, 200);
  if (/already[\s_-]?completed/i.test(message)) return { success: true, alreadyCompleted: true };
  throw new Error(`AutoClaw inspiration complete rejected: ${message}`);
}
