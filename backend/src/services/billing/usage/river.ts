/**
 * River AI account balance — GET https://console.river.ai/api/billing/account
 *
 * The inference API key cannot read the wallet. River exposes billing through
 * the console session instead: a WorkOS refresh token plus client ID mint an
 * access token, and that token authorizes the balance endpoint. River rotates
 * the refresh token on every authentication, so the caller persists the pair.
 * A connection without both values shows "-" (invalid), never 0.
 */

import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { authenticateRiver, riverCredentialPair } from "../../providers/riverAuth.ts";

const BILLING_URL = "https://console.river.ai/api/billing/account";
const EXPIRY_MARGIN_MS = 30_000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function usableToken(data: Record<string, unknown>): string {
  const accessToken = text(data.riverAccessToken);
  if (!accessToken) return "";
  const expiresAt = new Date(text(data.riverAccessExpiresAt)).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() <= EXPIRY_MARGIN_MS) return "";
  return accessToken;
}

function invalidQuota() {
  return {
    used: 0,
    total: 0,
    balance: null,
    unit: "USD",
    remainingPercentage: 100,
    resetAt: null,
    unlimited: false,
  };
}

function invalidUsage() {
  return {
    message: "-",
    quotas: { "Balance (USD)": invalidQuota() },
  };
}

async function readBalance(accessToken: string, proxyOptions: Record<string, unknown> | null) {
  return proxyAwareFetch(
    BILLING_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
    proxyOptions,
  );
}

export async function getRiverUsage(
  data: Record<string, unknown>,
  proxyOptions: Record<string, unknown> | null = null,
  persist: ((session: { accessToken: string; refreshToken: string; expiresAt: string }) => void) | null = null,
) {
  const pair = riverCredentialPair(data);
  if (!pair) return invalidUsage();

  let accessToken = usableToken(data);
  let response: Response;

  if (!accessToken) {
    try {
      const session = await authenticateRiver(pair.refreshToken, pair.clientId, proxyOptions);
      accessToken = session.accessToken;
      pair.refreshToken = session.refreshToken;
      persist?.(session);
    } catch (error: any) {
      return { ...invalidUsage(), message: `River AI login expired. Re-add the refresh token and client ID. (${error?.message || error})` };
    }
  }

  try {
    response = await readBalance(accessToken, proxyOptions);
  } catch (error: any) {
    return { message: `River AI balance request failed: ${error?.message || error}` };
  }

  if (response.status === 401) {
    try {
      const session = await authenticateRiver(pair.refreshToken, pair.clientId, proxyOptions);
      accessToken = session.accessToken;
      pair.refreshToken = session.refreshToken;
      persist?.(session);
      response = await readBalance(accessToken, proxyOptions);
    } catch (error: any) {
      return { ...invalidUsage(), message: `River AI login expired. Re-add the refresh token and client ID. (${error?.message || error})` };
    }
  }

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    return { message: `River AI balance API error (${response.status})${responseText ? `: ${responseText.slice(0, 120)}` : ""}` };
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(responseText || "{}");
  } catch {
    return { message: "River AI balance response was not JSON." };
  }

  const balance = Number(payload.balance_usd);
  if (!Number.isFinite(balance)) {
    return { message: "River AI connected. No balance data returned." };
  }

  return {
    plan: "River AI",
    quotas: {
      "Balance (USD)": {
        used: 0,
        total: 0,
        balance: Math.max(0, balance),
        unit: "USD",
        remainingPercentage: 100,
        resetAt: null,
        unlimited: false,
      },
    },
  };
}
