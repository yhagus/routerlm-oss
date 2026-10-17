import { deepseekHarnessPlatformHeaders } from "../../providers/deepseekHarnessPlatform.ts";
/**
 * DeepSeek Harness account balance — GET /api/v0/users/get_user_summary
 *
 * Reads the Platform wallet summary with the account token (x-dsh-auth-token).
 * Balances arrive as decimal strings per currency and map to the balance-style
 * quota rows the dashboard QuotaTable already renders (balance + unit).
 * No refresh token exists — a 401 or code 40003 means the user must sign in again.
 */

import { proxyAwareFetch } from "../../common/proxyFetch.ts";

const SUMMARY_URL = "https://platform.deepseek.com/api/v0/users/get_user_summary";

// dsh response envelope: {code: 0, data: {biz_code: 0, biz_data: ...}}
function unwrap(payload: any): any {
  if (payload?.code === 40003) {
    throw new Error("DeepSeek Harness authentication expired. Please sign in again.");
  }
  if (payload?.code !== 0 || payload?.data?.biz_code !== 0) {
    throw new Error(`DeepSeek Harness platform error: ${payload?.message || "unexpected response"}`);
  }
  return payload.data.biz_data;
}

function walletQuota(balance: string, currency: string) {
  const value = Math.max(0, Number(balance) || 0);
  return {
    used: 0,
    total: 0,
    balance: value,
    unit: currency,
    remainingPercentage: 100,
    resetAt: null,
    unlimited: false,
  };
}

export async function getDeepseekHarnessUsage(accessToken: any = null, proxyOptions: any = null) {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { message: "DeepSeek Harness access token not available. Sign in again." };
  }

  let response: Response;
  try {
    response = await proxyAwareFetch(
      SUMMARY_URL,
      {
        method: "GET",
        headers: {
          "x-dsh-auth-token": accessToken,
          Accept: "application/json",
          ...deepseekHarnessPlatformHeaders(),
        },
      },
      proxyOptions,
    );
  } catch (error: any) {
    return { message: `DeepSeek Harness balance request failed: ${error?.message || error}` };
  }

  const responseText = await response.text().catch(() => "");

  if (response.status === 401) {
    return { message: "DeepSeek Harness authentication expired. Please sign in again." };
  }
  if (!response.ok) {
    return { message: `DeepSeek Harness connected. API Error ${response.status}: ${responseText.slice(0, 100)}` };
  }

  let data: any;
  try {
    data = unwrap(JSON.parse(responseText || "{}"));
  } catch (error: any) {
    return { message: error?.message || "DeepSeek Harness returned an invalid response." };
  }

  const normal: any[] = Array.isArray(data?.normal_wallets) ? data.normal_wallets : [];
  const bonus: any[] = Array.isArray(data?.bonus_wallets) ? data.bonus_wallets : [];
  if (normal.length === 0 && bonus.length === 0) {
    return { message: "DeepSeek Harness connected. No wallet data returned." };
  }

  const quotas: Record<string, any> = {};
  for (const wallet of normal) {
    const currency = String(wallet?.currency || "CNY");
    quotas[`Recharge (${currency})`] = walletQuota(String(wallet?.balance || "0"), currency);
  }
  for (const wallet of bonus) {
    const currency = String(wallet?.currency || "CNY");
    quotas[`Bonus (${currency})`] = walletQuota(String(wallet?.balance || "0"), currency);
  }

  return { plan: "DeepSeek Harness", quotas };
}
