import { createHash } from "node:crypto";
import { BaseExecutor } from "./executors/base.js";
import { proxyAwareFetch } from "../common/proxyFetch.ts";

// Constants ported from autoclaw2api/config.py. The app-signing headers are
// required on every upstream call (refresh + chat), and X-Authorization carries
// the real account token (the standard Authorization header is a placeholder).
export const APP_ID = "100003";
export const APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";
export const PRODUCT = "autoclaw";
const VERSION = "1.17.6";
const PLATFORM = "mac";

const USER_API_BASE = "https://autoglm-api.autoglm.ai";
const CHAT_COMPLETIONS_URL = `${USER_API_BASE}/autoclaw-proxy/proxy/autoclaw/v1/chat/completions`;
const REFRESH_URL = `${USER_API_BASE}/userapi/v1/refresh`;

// Model ids are the upstream ids; X-Request-Model mirrors the model id directly.
const DEFAULT_MODEL = "zai_auto";
const TOKEN_TTL_SECONDS = 86_400;
// Refresh 5 minutes before expiry (parity with autoclaw2api REFRESH_MARGIN).
const REFRESH_MARGIN_MS = 300_000;

const SYSTEM_PROMPT =
  "You are a personal assistant running inside OpenClaw.\n## Tooling\nAvailable tools are policy-filtered. Names are case-sensitive; call exactly as listed.";

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function signHeaders(accessToken?: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = createHash("md5")
    .update(`${APP_ID}&${ts}&${APP_KEY}`)
    .digest("hex");
  const headers: Record<string, string> = {
    "X-Auth-Appid": APP_ID,
    "X-Auth-TimeStamp": ts,
    "X-Auth-Sign": sign,
    "X-Product": PRODUCT,
    "X-Version": VERSION,
    "X-Tm": PLATFORM,
    "X-Trace-Id": crypto.randomUUID(),
    "Content-Type": "application/json",
  };
  if (accessToken) {
    const raw = accessToken.replace("Bearer ", "");
    headers["X-Authorization"] = `Bearer ${raw}`;
  }
  return headers;
}

function upstreamModelFor(model: string | undefined): string {
  return (model && model.trim()) || DEFAULT_MODEL;
}

export async function autoclawRefresh(
  refreshToken: string,
  deviceId?: string,
  proxyOptions: Record<string, any> | null = null,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  if (!refreshToken) return null;
  const response = await proxyAwareFetch(REFRESH_URL, {
    method: "POST",
    headers: signHeaders(),
    body: JSON.stringify({
      source_id: "autoclaw",
      device_id: deviceId || crypto.randomUUID(),
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  }, proxyOptions);
  if (!response.ok) return null;
  const data = (await response.json()) as {
    code?: number;
    data?: { access_token?: string; refresh_token?: string };
  };
  if (data?.code !== 0 || !data?.data?.access_token) return null;
  return {
    accessToken: data.data.access_token,
    refreshToken: data.data.refresh_token || refreshToken,
  };
}

export class AutoclawExecutor extends BaseExecutor {
  provider = "autoclaw";

  currentUpstreamModel = DEFAULT_MODEL;

  constructor() {
    super("autoclaw", { format: "openai" });
  }

  buildUrl(): string {
    return CHAT_COMPLETIONS_URL;
  }

  transformRequest(model: string, body: Record<string, any>): Record<string, any> {
    const upstream = upstreamModelFor(model);
    this.currentUpstreamModel = upstream;
    const next: Record<string, any> = { ...body, model: upstream, stream: true };
    const sourceMessages = Array.isArray(next.messages)
      ? (next.messages as Record<string, any>[])
      : [];
    const messages = sourceMessages.map((message) => ({ ...message }));
    if (
      !(
        messages.length &&
        messages[0]?.role === "system" &&
        messages[0]?.content === SYSTEM_PROMPT
      )
    ) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }
    next.messages = messages;
    return next;
  }

  buildHeaders(credentials: Record<string, any>, _stream = true): Record<string, string> {
    const headers = signHeaders(
      typeof credentials?.accessToken === "string"
        ? credentials.accessToken
        : undefined,
    );
    headers["Accept"] = "application/json";
    headers["Authorization"] = "Bearer autoclaw-internal-proxy";
    headers["X-Request-Id"] = crypto.randomUUID();
    headers["X-Request-Model"] = this.currentUpstreamModel || DEFAULT_MODEL;
    headers["X-Channel"] = "official";
    headers["X-Client-Type"] = "pc";
    headers["X-Lang"] = "en";
    headers["X-Agent-Id"] = "main";
    headers["X-AutoClaw-Agent-Id"] = "main";
    headers["User-Agent"] = "OpenAI/JS 6.39.1";
    return headers;
  }

  needsRefresh(credentials: Record<string, any>): boolean {
    if (typeof credentials?.accessToken !== "string" || !credentials.accessToken)
      return true;
    const expiresAt = credentials?.expiresAt;
    if (typeof expiresAt !== "string" || !expiresAt) return false;
    const expiryMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiryMs)) return false;
    return Date.now() >= expiryMs - REFRESH_MARGIN_MS;
  }

  async refreshCredentials(
    credentials: Record<string, any>,
    _log?: unknown,
    proxyOptions: Record<string, any> | null = null,
  ): Promise<RefreshResult | null> {
    const refreshToken =
      typeof credentials?.refreshToken === "string"
        ? credentials.refreshToken
        : "";
    const deviceId =
      (typeof credentials?.deviceId === "string"
        ? credentials.deviceId
        : "") ||
      (typeof credentials?.providerSpecificData?.deviceId === "string"
        ? credentials.providerSpecificData.deviceId
        : "") ||
      crypto.randomUUID();
    const refreshed = await autoclawRefresh(refreshToken, deviceId, proxyOptions);
    if (!refreshed) return null;
    return { ...refreshed, expiresIn: TOKEN_TTL_SECONDS };
  }
}