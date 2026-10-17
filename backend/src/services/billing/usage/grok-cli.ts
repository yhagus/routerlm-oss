/**
 * Grok CLI / Grok Build usage handler
 *
 * Source of truth: official grok-shell/grok-pager traffic to cli-chat-proxy.grok.com
 *   GET /v1/billing?format=credits
 *   GET /v1/user?include=subscription
 *
 * Observed billing shape (protobuf-json style `{ val: number }`):
 * {
 *   config: {
 *     currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start, end },
 *     onDemandCap: { val },
 *     onDemandUsed: { val },
 *     prepaidBalance: { val },
 *     isUnifiedBillingUser: true,
 *     billingPeriodStart, billingPeriodEnd
 *   }
 * }
 *
 * Account states:
 * - Free tier: subscriptionTier="Free", onDemandCap={val:0}, prepaidBalance={val:0},
 *              creditUsagePercent undefined → local rolling token allowance
 * - Exhausted free: Same as above BUT chat API returns 402 "personal-team-blocked:spending-limit"
 *                   OR creditUsagePercent >= 100%
 * - Paid/SuperGrok: subscriptionTier="SuperGrok [tier]", has prepaidBalance > 0 OR 
 *                   uses gRPC GetGrokCreditsConfig for weekly pool tracking
 *
 * IMPORTANT: Free-tier usage is observed locally over a rolling 24-hour window. The
 * upstream billing period is not used as the free-tier reset window.
 */

import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import {
  GROK_CLI_AUTHENTICATE_RESPONSE,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_CLIENT_MODE,
  GROK_CLI_FREE_USAGE_TOKEN_LIMIT,
  GROK_CLI_FREE_USAGE_WINDOW_MS,
  GROK_CLI_TOKEN_AUTH,
  GROK_CLI_USER_AGENT,
  GROK_CLI_VERSION,
} from "../../providers/config/grokCli.ts";
import { decodeGrokCreditsFrame } from "./grokCliQuotaFrame.js";

const USAGE = U("grok-cli");
const BILLING_URL = USAGE.url || "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const USER_URL = USAGE.userUrl || "https://cli-chat-proxy.grok.com/v1/user?include=subscription";

// SuperGrok weekly pool.
const GRPC_CREDITS_URL =
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
// Empty gRPC-web request frame (flag 0 + length 0). Without it upstream returns
// grpc-status 13 "Missing request message." with a 0-byte body.
const GRPC_WEB_EMPTY_REQUEST_FRAME = Buffer.from([0, 0, 0, 0, 0]);

/** Unwrap protobuf-json `{ val: n }` or plain numbers/strings. */
function unwrapVal(value: any, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value) && "val" in value) {
    return toFiniteNumber(value.val, fallback);
  }
  return toFiniteNumber(value, fallback);
}

/**
 * Detect if Grok Build account has active daily allowance vs exhausted status.
 * Official CLI behavior: quota tracking only starts when approaching ~80% usage.
 * 
 * @param {number|null} usagePct - creditUsagePercent from billing API (NaN if not set)
 * @param {number} prepaid - prepaidBalance value
 * @param {number} onDemandUsed - on-demand usage this period
 * @param {number} onDemandCap - on-demand cap
 * @returns {boolean} True if account is exhausted (needs red 0% indicator), false if active
 */
function isExhaustedFreeTier(usagePct: any, prepaid: any, onDemandUsed: any, onDemandCap: any) {
  // Truly exhausted cases:
  // 1. Usage >= 100% (weekly limit exceeded)
  if (Number.isFinite(usagePct) && usagePct >= 100) {
    return true;
  }
  
  // 2. No purchased credits AND on-demand used >= cap (exhausted promo/paid credits)
  // Note: For free tier, both cap and prepaid are 0, so we need chat 402 to confirm exhaustion
  // Here we check: if user had any allocated credits (cap > 0 or prepaid > 0) and they're all spent
  if (!Number.isFinite(onDemandCap) || onDemandCap > 0) {
    return prepaid === 0 && Number.isFinite(onDemandUsed) && onDemandUsed >= onDemandCap;
  }
  
  // Default: Assume active free tier with rolling daily allowance (not exhausted yet)
  return false;
}

function buildGrokCliHeaders(accessToken: any, providerSpecificData: any = {}) {
  const psd = providerSpecificData || {};
  const headers: Record<string, any> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": GROK_CLI_USER_AGENT,
    "x-xai-token-auth": GROK_CLI_TOKEN_AUTH,
    "x-authenticateresponse": GROK_CLI_AUTHENTICATE_RESPONSE,
    "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-mode": GROK_CLI_CLIENT_MODE,
  };
  const email = psd.email;
  const userId = psd.userId || psd.principalId;
  if (email) headers["x-email"] = email;
  if (userId) headers["x-userid"] = userId;
  return headers;
}

function subscriptionTier(user: any, config: any) {
  const rawTier =
    user?.subscriptionTier ??
    user?.subscription_tier ??
    user?.subscription?.tier ??
    config?.subscriptionTier ??
    config?.subscription_tier;
  return typeof rawTier === "string" ? rawTier.trim() : "";
}

function resolvePlan(user: any, config: any) {
  const tier = subscriptionTier(user, config);
  if (tier) {
    return tier
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (user?.hasGrokCodeAccess === true) return "Grok Code";
  if (config?.isUnifiedBillingUser === true) return "Grok Build";
  return "Grok Build";
}

function makeQuota({ used, total, resetAt, unlimited = false }: any) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  // Do NOT set absolute `remaining` — QuotaTable's getRemainingPercentage treats
  // `remaining` as a 0–100 percentage (same trap as Qoder credits).
  if (unlimited || safeTotal === 0) {
    return {
      used: safeUsed,
      total: 0,
      remainingPercentage: unlimited ? 100 : 0,
      resetAt: resetAt || null,
      unlimited: true,
    };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  const remainingPercentage = (remaining / safeTotal) * 100;
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

/**
 * Parse the confirmed token pair included in Grok's free-quota exhaustion error.
 * The pair is upstream data; it is intentionally not inferred from local usage.
 */
export function parseGrokCliFreeUsageTokens(errorText: any) {
  const text = typeof errorText === "string"
    ? errorText
    : String(JSON.stringify(errorText || "") || "");
  const match = text.match(/tokens\s*\(\s*actual\s*\/\s*limit\s*\)\s*:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  if (!match) return null;

  const used = Number(match[1].replaceAll(",", ""));
  const limit = Number(match[2].replaceAll(",", ""));
  if (!Number.isFinite(used) || !Number.isFinite(limit) || used < 0 || limit <= 0) return null;
  return { used, limit };
}

export function buildGrokCliFreeQuota({ observedTokens = 0, actualUsed = NaN, actualLimit = NaN, resetAt = null } = {} as any) {
  const hasActualQuota = Number.isFinite(actualUsed) && actualUsed >= 0 &&
    Number.isFinite(actualLimit) && actualLimit > 0;
  const used = hasActualQuota ? actualUsed : Math.max(0, toFiniteNumber(observedTokens, 0));
  const total = hasActualQuota ? actualLimit : GROK_CLI_FREE_USAGE_TOKEN_LIMIT;

  return {
    used,
    total,
    remainingPercentage: Math.max(0, ((total - used) / total) * 100),
    resetAt: resetAt || null,
    unlimited: false,
  };
}

/**
 * Map billing JSON → normalized quotas object for the dashboard.
 * 
 * Handles 3 states:
 * 1. Active SuperGrok/Paid: Shows on-demand cap, prepaid balance, weekly pool (gRPC)
 * 2. Active Free Tier: Shows the locally observed rolling 24-hour token allowance
 * 3. Exhausted Free Tier: Shows confirmed upstream actual/limit values when available
 * 
 * Returns { quotas, periodEnd, exhaustedHint } or empty quotas when nothing usable.
 */
export function parseGrokCliBilling(billing: any, user: any = null) {
  const root = billing && typeof billing === "object" ? billing : {};
  const config =
    root.config && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : root;

  const periodEnd =
    parseResetTime(config.billingPeriodEnd) ||
    parseResetTime(config.billing_period_end) ||
    parseResetTime(config.currentPeriod?.end) ||
    parseResetTime(config.resetAt || config.resetsAt || config.periodEnd) ||
    parseResetTime(root.billingPeriodEnd) ||
    parseResetTime(root.billing_period_end) ||
    parseResetTime(root.resetAt || root.resetsAt || root.periodEnd) ||
    null;

   const quotas: Record<string, any> = {};
   const tier = subscriptionTier(user, config);
   const subscriptionAccess = Boolean(tier) && !/^(free|none|null)$/i.test(tier);

   // Current Grok Build responses expose included monthly usage at top level.
   // Official Grok CLI returns:
   // - Free tier: subscriptionTier="Free", onDemandCap={val:0}, prepaidBalance={val:0}, creditUsagePercent undefined (<80%)
   // - Exhausted free: same structure BUT chat API returns 402 "personal-team-blocked:spending-limit"
   // - SuperGrok (paid): subscriptionTier="SuperGrok", may have prepaidBalance > 0 OR weekly pool via gRPC

  const monthlyLimit = unwrapVal(
    config.monthlyLimit ?? config.monthly_limit ?? root.monthlyLimit ?? root.monthly_limit,
    NaN,
  );
  const includedUsed = unwrapVal(
    config.includedUsed ?? config.included_used ?? root.includedUsed ?? root.included_used,
    NaN,
  );
  const totalUsed = unwrapVal(
    config.totalUsed ?? config.total_used ?? root.totalUsed ?? root.total_used,
    NaN,
  );
  if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
    quotas["Monthly included"] = makeQuota({
      used: Number.isFinite(includedUsed)
        ? includedUsed
        : Number.isFinite(totalUsed)
          ? totalUsed
          : 0,
      total: monthlyLimit,
      resetAt: periodEnd,
    });
  }

   // Primary: on-demand spending window (subscription / promo credits)
   const onDemandCap = unwrapVal(config.onDemandCap ?? root.onDemandCap, NaN);
   const onDemandUsed = unwrapVal(config.onDemandUsed ?? root.onDemandUsed, NaN);
   const prepaid = unwrapVal(config.prepaidBalance ?? root.prepaidBalance, NaN);
   if (Number.isFinite(onDemandCap) && onDemandCap > 0) {
     const used = Number.isFinite(onDemandUsed) ? Math.max(0, onDemandUsed) : 0;
     quotas["On-demand"] = makeQuota({
       used,
       total: onDemandCap,
       resetAt: periodEnd,
     });
  } else if (
    !subscriptionAccess &&
    Number.isFinite(onDemandCap) &&
    onDemandCap === 0 &&
    Number.isFinite(onDemandUsed)
  ) {
    // Check if this is an ACTIVE free tier (not exhausted):
    // - creditUsagePercent undefined (< 80%) → has active daily allowance
    // - prepaidBalance === 0 → using included free tier (not out of purchased credits)
    const usagePct = unwrapVal(
      config.creditUsagePercent ?? config.credit_usage_percent ?? root.creditUsagePercent,
      NaN,
    );
    
    // Official Grok CLI only shows "exhausted" when chat API returns 402 with spending-limit
    // or when creditUsagePercent >= 100%. Free tier accounts with cap=0/prepaid=0 but 
    // usagePct undefined/<80% have active daily allowance, not exhausted status.
    const exhausted = isExhaustedFreeTier(usagePct, prepaid, onDemandUsed, onDemandCap);
    
    if (exhausted) {
      // Truly exhausted free/promo account (chat would return 402 spending-limit)
      quotas["Daily Allowance"] = {
        used: 100,
        total: 100,
        remainingPercentage: 0,
        // The billing period is not the free-tier reset window.
        resetAt: null,
        unlimited: false,
      };
    } else {
      // Active free tier with daily allowance — show as unlimited when the
      // provider omits a numeric usage value. Billing's currentPeriod is not
      // the free-tier reset window, so do not expose it as a countdown.
       quotas["Daily Allowance"] = {
         used: Number.isFinite(usagePct) ? usagePct : 0,
         total: Number.isFinite(usagePct) ? 100 : 0,
         remainingPercentage: Number.isFinite(usagePct)
           ? Math.max(0, 100 - usagePct)
           : 100,
         resetAt: new Date(Date.now() + GROK_CLI_FREE_USAGE_WINDOW_MS).toISOString(),
         unlimited: !Number.isFinite(usagePct),
       };

    }
  }

  // Prepaid top-up balance (remaining credits; no fixed allotment known)
  if (Number.isFinite(prepaid) && prepaid > 0) {
    // Show full bar against the current balance (0 spent of this remaining pot).
    quotas["Prepaid"] = {
      used: 0,
      total: prepaid,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
    };
  }

  // SuperGrok weekly shared-pool usage (subscription tier). creditUsagePercent is
  // the single total used %; productUsage is a breakdown legend, NOT independent
  // quotas — never split it into separate bars.
  const usedPct = unwrapVal(
    config.creditUsagePercent ?? config.credit_usage_percent ?? root.creditUsagePercent,
    NaN,
  );
  // A paid 100% REST value is an exhausted snapshot; let the live credits
  // probe confirm the current shared-pool state before rendering it.
  if (subscriptionAccess && Number.isFinite(usedPct) && usedPct >= 0 && usedPct < 100) {
    quotas["Weekly SuperGrok"] = makeQuota({
      used: Math.max(0, Math.min(100, usedPct)),
      total: 100,
      resetAt: periodEnd,
    });
  }

  // Opportunistic richer credit envelopes (future / other account types)
  const creditBags = [
    root.credits,
    root.creditBalance,
    root.usage,
    config.credits,
    config.includedCredits,
    config.subscriptionCredits,
  ].filter((bag) => bag && typeof bag === "object" && !Array.isArray(bag));

  for (const bag of creditBags) {
    const total = unwrapVal(
      bag.total ?? bag.limit ?? bag.cap ?? bag.allocation ?? bag.amount,
      NaN,
    );
    const used = unwrapVal(bag.used ?? bag.spent ?? bag.consumed, NaN);
    const remaining = unwrapVal(bag.remaining ?? bag.balance ?? bag.left, NaN);
    if (Number.isFinite(total) && total > 0) {
      const resolvedUsed = Number.isFinite(used)
        ? used
        : Number.isFinite(remaining)
          ? Math.max(0, total - remaining)
          : 0;
      if (!quotas.Credits) {
        quotas.Credits = makeQuota({
          used: resolvedUsed,
          total,
          resetAt: parseResetTime(bag.resetAt || bag.resetsAt || bag.end) || periodEnd,
        });
      }
    } else if (Number.isFinite(remaining) && remaining >= 0 && !quotas.Credits) {
      quotas.Credits = {
        used: 0,
        total: remaining > 0 ? remaining : 1,
        remainingPercentage: remaining > 0 ? 100 : 0,
        resetAt: periodEnd,
        unlimited: false,
      };
    }
  }

  // Exhausted when every finite quota bar is at 0% remaining
  const exhausted =
    Object.keys(quotas).length > 0 &&
    Object.values(quotas).every(
      (q) => q.unlimited !== true && (q.remainingPercentage ?? 100) <= 0,
    );

  return {
    plan: resolvePlan(user, config),
    quotas,
    periodEnd,
    exhausted,
    subscriptionAccess,
    freeTier: !subscriptionAccess && Boolean(quotas["Daily Allowance"]),
    rawConfig: config,
  };
}

/**
 * Live SuperGrok weekly pool via gRPC-web GetGrokCreditsConfig.
 * Fail-open: any network/auth/parse failure returns null.
 * @returns {{ percentUsed: number, resetAt: string|null } | null}
 */
export async function fetchGrokCliCreditsConfig(accessToken: any, proxyOptions: any = null) {
  if (!accessToken) return null;
  try {
    const res = await proxyAwareFetch(
      GRPC_CREDITS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/grpc-web+proto",
          "X-Grpc-Web": "1",
          Accept: "application/grpc-web+proto",
        },
        body: GRPC_WEB_EMPTY_REQUEST_FRAME,
      },
      proxyOptions,
    );
    if (!res?.ok) return null;
    const arrayBuffer = await res.arrayBuffer().catch(() => null);
    if (!arrayBuffer) return null;
    return decodeGrokCreditsFrame(Buffer.from(arrayBuffer));
  } catch {
    return null;
  }
}

function quotasFromGrpcCredits(decoded: any, quotaName = "Weekly SuperGrok") {
  if (!decoded || !Number.isFinite(decoded.percentUsed)) return null;
  // Round for bar display (fixed32 ratio * 100 can be 34.999… for 0.35)
  const used = Math.round(Math.max(0, Math.min(100, decoded.percentUsed)));
  return {
    [quotaName]: makeQuota({
      used,
      total: 100,
      resetAt: decoded.resetAt || null,
    }),
  };
}

/**
 * @param {string} accessToken
 * @param {object|null} providerSpecificData
 * @param {object|null} proxyOptions
 */
export async function getGrokCliUsage(accessToken: any, providerSpecificData: any = null, proxyOptions: any = null) {
  if (!accessToken) {
    return { message: "Grok CLI access token not available." };
  }

  const forcedResetSource = providerSpecificData?.grokCliFreeUsageResetSource || null;
  const forcedResetAt = forcedResetSource === "credits"
    ? providerSpecificData?.grokCliFreeUsageResetAt || null
    : null;
  const forcedResetMs = forcedResetAt ? new Date(forcedResetAt).getTime() : NaN;
  const forcedExhausted = providerSpecificData?.grokCliFreeUsageExhausted === true &&
    (forcedResetSource === "unknown" ||
      (forcedResetSource === "credits" && Number.isFinite(forcedResetMs) && forcedResetMs > Date.now()));
  if (forcedExhausted) {
    const forcedUsed = toFiniteNumber(providerSpecificData?.grokCliFreeUsageActualUsed, NaN);
    const forcedLimit = toFiniteNumber(providerSpecificData?.grokCliFreeUsageActualLimit, NaN);
    const hasActualTokens = Number.isFinite(forcedUsed) && Number.isFinite(forcedLimit) && forcedLimit > 0;
    return {
      plan: "Grok Build",
      quotas: {
         "Daily Allowance": makeQuota({
           used: hasActualTokens ? forcedUsed : 100,
           total: hasActualTokens ? forcedLimit : 100,
           resetAt: new Date(Date.now() + GROK_CLI_FREE_USAGE_WINDOW_MS).toISOString(),
         }),

      },
      freeTier: true,
    };
  }

  const headers = buildGrokCliHeaders(accessToken, providerSpecificData);

  try {
    // Fetch billing + user profile in parallel (same pattern as official CLI startup)
    const [billingRes, userRes] = await Promise.all([
      proxyAwareFetch(
        BILLING_URL,
        { method: "GET", headers },
        proxyOptions,
      ),
      proxyAwareFetch(
        USER_URL,
        { method: "GET", headers },
        proxyOptions,
      ).catch(() => null),
    ]);

    if (billingRes.status === 401 || billingRes.status === 403) {
      return { message: "Grok CLI authentication expired. Please re-authorize." };
    }

    if (!billingRes.ok) {
      const errText = await billingRes.text().catch(() => "");
      const trimmed = errText ? `: ${errText.slice(0, 200)}` : "";
      return { message: `Grok CLI billing API error (${billingRes.status})${trimmed}` };
    }

    const billing = await billingRes.json().catch(() => null);
    if (!billing || typeof billing !== "object") {
      return { message: "Grok CLI billing response was not JSON." };
    }

    let user = null;
    if (userRes?.ok) {
      user = await userRes.json().catch(() => null);
    }

    const parsed = parseGrokCliBilling(billing, user);

    const dailyAllowance = parsed.quotas?.["Daily Allowance"];
    const shouldProbeGrpc =
      (!parsed.subscriptionAccess && Boolean(dailyAllowance)) ||
      !parsed.quotas ||
      Object.keys(parsed.quotas).length === 0;

    if (shouldProbeGrpc) {
      // Probe the credits endpoint for an explicit usage/reset timestamp.
      // The REST billing period is not a reliable free-tier reset indicator.
      const grpc = await fetchGrokCliCreditsConfig(accessToken, proxyOptions);
      const grpcQuotas = quotasFromGrpcCredits(
        grpc,
        parsed.subscriptionAccess ? "Weekly SuperGrok" : "Daily Allowance",
      );
      if (grpcQuotas) {
        return {
          plan: parsed.plan,
          quotas: {
            ...(parsed.quotas || {}),
            ...grpcQuotas,
          },
          freeTier: !parsed.subscriptionAccess && Boolean(grpcQuotas["Daily Allowance"]),
        };
      }

      if (Object.keys(parsed.quotas || {}).length === 0) {
        return {
          plan: parsed.plan,
          message: parsed.subscriptionAccess
            ? "Subscription access is active; Grok does not expose a numeric included quota."
            : "Grok Build connected, but no credit allotment was returned. Free promo may be exhausted.",
          quotas: {} as Record<string, any>,
        };
      }
    }

    // Dashboard hides QuotaTable whenever `message` is set, so only attach a
    // message when there are no quota rows to render. Depleted accounts keep
    // the 0% On-demand bar without a blocking message.
    return {
      plan: parsed.plan,
      quotas: parsed.quotas,
      freeTier: parsed.freeTier,
    };
  } catch (error: any) {
    return { message: `Grok CLI usage error: ${error.message}` };
  }
}
