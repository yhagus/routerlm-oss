import type { ProviderConnection } from "../../db/repositories";
import { getProviderUsageConfig } from "../providers/providerCatalog";
import type { Runtime } from "../../runtime";
import { refreshConnectionCredentials } from "../providers/refreshCoordinator";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

export function isAuthExpiredResult(result: unknown): boolean {
  const record = (result && typeof result === "object" ? result : {}) as { message?: unknown; code?: unknown; raw?: { detail?: unknown; error?: unknown } };
  const values = [record.message, record.code, record.raw?.detail, record.raw?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value as string | number | Date);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function codexAccountId(connection: ProviderConnection): string | null {
  return (connection.data.workspaceId as string | undefined) || (connection.data.accountId as string | undefined) || (connection.data.chatgptAccountId as string | undefined) || null;
}

function accessToken(connection: ProviderConnection): string | null {
  const token = connection.credentials.accessToken ?? connection.data.accessToken;
  return typeof token === "string" && token ? token : null;
}

function creditHeaders(connection: ProviderConnection, json: boolean): Headers {
  const headers = new Headers({
    authorization: `Bearer ${accessToken(connection)}`,
    accept: "application/json",
    "openai-beta": "codex-1",
    originator: "codex_cli_rs",
  });
  if (json) headers.set("content-type", "application/json");
  const accountId = codexAccountId(connection);
  if (accountId) headers.set("chatgpt-account-id", accountId);
  return headers;
}

export interface CodexCredits {
  availableCount: number;
  credits: Array<{ status: string; grantedAt: string | null; expiresAt: string | null }>;
}

export async function getCodexRateLimitResetCredits(connection: ProviderConnection): Promise<CodexCredits> {
  const token = accessToken(connection);
  if (!token) throw new Error("No Codex access token available. Please re-authorize the connection.");
  const { resetCreditsUrl } = getProviderUsageConfig("codex");
  if (!resetCreditsUrl) throw new Error("Codex reset credits endpoint is not configured.");
  const response = await fetch(resetCreditsUrl, { method: "GET", headers: creditHeaders(connection, false), signal: AbortSignal.timeout(20_000) });
  let data: Record<string, unknown> | null = null;
  try { data = await response.json() as Record<string, unknown>; } catch { data = null; }
  if (!response.ok) {
    const message = (data?.message as string) || (data?.error as string) || (data?.detail as string) || `Codex reset credits API unavailable (${response.status}).`;
    throw new Error(String(message));
  }
  const credits = Array.isArray(data?.credits) ? (data?.credits as Array<Record<string, unknown>>) : [];
  return {
    availableCount: Math.max(0, toFiniteNumber(data?.available_count ?? data?.availableCount, 0)),
    credits: credits.map((credit) => ({
      status: String(credit?.status || "unknown"),
      grantedAt: toIsoDate(credit?.granted_at ?? credit?.grantedAt),
      expiresAt: toIsoDate(credit?.expires_at ?? credit?.expiresAt),
    })),
  };
}

export interface CodexConsumeResult {
  ok: boolean;
  noCredit: boolean;
  status: number;
  code: string | null;
  windowsReset: number;
  message: string | null;
  raw: unknown;
}

// Spending a credit is irreversible, so the caller generates the redeem id.
export async function consumeCodexRateLimitResetCredit(connection: ProviderConnection, redeemRequestId: string): Promise<CodexConsumeResult> {
  const token = accessToken(connection);
  if (!token) throw new Error("No Codex access token available. Please re-authorize the connection.");
  if (!redeemRequestId || typeof redeemRequestId !== "string") {
    throw new Error("A redeem request id is required to consume a Codex reset credit.");
  }
  const { resetCreditsConsumeUrl } = getProviderUsageConfig("codex");
  if (!resetCreditsConsumeUrl) throw new Error("Codex reset credits endpoint is not configured.");
  const response = await fetch(resetCreditsConsumeUrl, {
    method: "POST",
    headers: creditHeaders(connection, true),
    body: JSON.stringify({ redeem_request_id: redeemRequestId }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, unknown> : null;
  const code = (data?.code as string) || null;
  const windowsReset = toFiniteNumber(data?.windows_reset, 0);
  const success = response.ok && (code === "reset" || windowsReset > 0);
  return {
    ok: success,
    noCredit: response.ok && code === "no_credit",
    status: response.status,
    code,
    windowsReset,
    message: (data?.message as string) || null,
    raw: data,
  };
}

export interface RefreshOutcome {
  connection: ProviderConnection;
  refreshed: boolean;
}

// Refreshes a Codex Connection through the refresh coordinator, so a
// concurrent chat request on the same Connection shares one refresh. With
// `afterAuthFailure` (the API rejected the token of `connection`), it
// refreshes only when the stored token is still that token; without it, only
// near expiry.
export async function refreshCodexConnection(
  runtime: Pick<Runtime, "repos">,
  connection: ProviderConnection,
  options: { afterAuthFailure?: boolean } = {},
): Promise<RefreshOutcome | { error: string }> {
  const outcome = await refreshConnectionCredentials(runtime, connection.id, options.afterAuthFailure ? { failedAccessToken: accessToken(connection) } : {});
  const current = runtime.repos.providers.get(connection.id) ?? connection;
  if (outcome) return { connection: current, refreshed: outcome.refreshed };
  if (accessToken(current)) return { connection: current, refreshed: false };
  return { error: "Credential refresh failed: token refresh returned no credentials" };
}
