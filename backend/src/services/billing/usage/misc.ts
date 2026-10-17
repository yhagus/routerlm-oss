/**
 * Misc usage handlers (GLM, Qoder)
 */

import { proxyAwareFetch } from "../../common/proxyFetch.ts";
import { U } from "./shared.js";
import { buildCosyHeaders } from "../../providers/cli-auth/qoder/cosy.ts";
import { QODER_ACTIVITY_STATUS_URL } from "../../providers/cli-auth/qoder/constants.ts";

// GLM quota endpoints (region-aware) — url from registry transport.usage
const GLM_QUOTA_URLS = {
  international: U("glm").url,
  china: U("glm-cn").url,
};

/**
 * GLM Coding Plan usage (international + China regions)
 */
export async function getGlmUsage(apiKey: any, provider: any, proxyOptions: any = null) {
  if (!apiKey) {
    return { message: "GLM API key not available." };
  }

  const region = provider === "glm-cn" ? "china" : "international";
  const quotaUrl = GLM_QUOTA_URLS[region];

  try {
    const response = await proxyAwareFetch(quotaUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "GLM API key invalid or expired." };
      }
      return { message: `GLM quota API error (${response.status}).` };
    }

    const json = await response.json();
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    const limits = Array.isArray(data.limits) ? data.limits : [];
    const quotas: Record<string, any> = {};
    for (const limit of limits) {
      if (!limit || limit.type !== "TOKENS_LIMIT") continue;
      const usedPercent = Number(limit.percentage) || 0;
      const resetMs = Number(limit.nextResetTime) || 0;
      const remaining = Math.max(0, 100 - usedPercent);

      quotas["session"] = {
        used: usedPercent,
        total: 100,
        remaining,
        remainingPercentage: remaining,
        resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null,
        unlimited: false,
      };
    }

    const levelRaw = typeof data.level === "string" ? data.level : "";
    const plan = levelRaw
      ? levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1).toLowerCase()
      : "Unknown";

    return { plan, quotas };
  } catch (error: any) {
    return { message: `GLM error: ${error.message}` };
  }
}

export async function getQoderUsage(accessToken: any, providerSpecificData: any = {}, proxyOptions: any = null) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      U("qoder").url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total.
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
    const quotas: Record<string, any> = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt,
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt,
      },
    };

    const userId = providerSpecificData?.userId;
    if (userId) {
      try {
        const activityResponse = await proxyAwareFetch(
          QODER_ACTIVITY_STATUS_URL,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Accept-Encoding": "identity",
              ...buildCosyHeaders(Buffer.alloc(0), QODER_ACTIVITY_STATUS_URL, {
                userId,
                authToken: accessToken,
                name: providerSpecificData?.name || "",
                email: providerSpecificData?.email || "",
                machineId: providerSpecificData?.machineId || "",
                organizationId: providerSpecificData?.organizationId || "",
              }),
            },
          },
          proxyOptions,
        );
        const activityBody = activityResponse.ok
          ? await activityResponse.json().catch(() => null)
          : null;
        const activities = Array.isArray(activityBody?.data?.activities)
          ? activityBody.data.activities
          : [];
        for (const activity of activities) {
          const limit = Number(activity?.limit);
          if (!activity?.activityId || !Number.isFinite(limit) || limit <= 0) continue;
          const used = Math.min(limit, Math.max(0, Number(activity.used) || 0));
          const endAt = Number(activity.activityEndAt);
          quotas[`event:${activity.activityId}`] = {
            total: limit,
            used,
            remaining: Math.max(0, limit - used),
            unit: "calls",
            displayName: `Event: ${activity.modelName || activity.activityId}`,
            resetAt: Number.isFinite(endAt) && endAt > 0 ? new Date(endAt).toISOString() : null,
            recurring: activity.resetStrategy !== "NEVER_EXPIRE",
            activityId: activity.activityId,
          };
        }
      } catch {
        // Activity quotas supplement the normal Qoder quota response; a
        // missing API3 session identity must not hide the primary quotas.
      }
    }
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error: any) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}
