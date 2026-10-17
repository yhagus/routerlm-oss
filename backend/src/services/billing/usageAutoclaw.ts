// AutoClaw usage — GET the agent-assetmgr wallets endpoint. Each wallet is a
// points balance (no fixed allotment), so rows expose a raw `balance` the
// dashboard renders as a formatted number rather than a percentage bar.
import { proxyAwareFetch } from "../common/proxyFetch.ts";

const WALLET_URL =
  "https://autoglm-api.autoglm.ai/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw";

const WALLET_NAMES: Record<string, string> = {
  reward: "Reward",
  daily: "Daily",
  other: "Other",
};

const WALLET_TYPES = new Set(["reward", "daily", "other"]);

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getAutoclawUsage(
  accessToken: string,
  proxyOptions: Record<string, unknown> | null = null,
): Promise<Record<string, unknown>> {
  // The stored token may carry a "Bearer " prefix (the refresh flow stores it
  // verbatim); strip it so the Authorization header isn't "Bearer Bearer …".
  const token = accessToken.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { message: "AutoClaw access token not available. Add a connection to view balance." };
  }

  try {
    const response = await proxyAwareFetch(
      WALLET_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { plan: "AutoClaw", message: "AutoClaw authentication failed. Check the refresh token." };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        plan: "AutoClaw",
        message: `AutoClaw balance API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const data = (await response.json().catch(() => null)) as
      | { code?: number; msg?: string; data?: { wallets?: Array<Record<string, unknown>> } }
      | null;
    const wallets = Array.isArray(data?.data?.wallets) ? data.data.wallets : [];
    if (data?.code !== 0 || wallets.length === 0) {
      const msg = typeof data?.msg === "string" && data.msg ? data.msg : "";
      return {
        plan: "AutoClaw",
        message: msg
          ? `AutoClaw balance error: ${msg}`
          : "AutoClaw connected. No balance data returned.",
      };
    }

    const quotas: Record<string, unknown> = {};
    for (const wallet of wallets) {
      const type = String(wallet.public_wallet_type || "");
      if (!WALLET_TYPES.has(type)) continue;
      quotas[type] = {
        name: WALLET_NAMES[type] || String(wallet.display_name || type),
        balance: finite(wallet.balance),
        unit: "points",
        resetAt: null,
      };
    }

    return { plan: "AutoClaw", quotas };
  } catch (error: any) {
    return { message: `AutoClaw error: ${(error as Error).message}` };
  }
}
