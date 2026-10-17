/**
 * QuotaTracker — comprehensive quota tracking for Grok CLI / Grok Build
 * 
 * Mirrors grok2api's quota system:
 * - Multiple quota modes (weekly, fast, console, image_pro, etc.)
 * - Background refresh service
 * - Quota decrement after successful requests
 * - Rate limit tracking (429 responses)
 * - Quota recovery for exhausted windows
 * - Product breakdown parsing
 * 
 * Rate limits are determined by upstream 429 responses, not local daily allowance.
 */

import type { Runtime } from "../../runtime.js";
import type { QuotaWindowRecord, QuotaRecoveryRecord, RateLimitEventRecord } from "../../db/repositories.js";
import {
  QuotaMode,
  QuotaSource,
  type QuotaModeValue,
  type QuotaBreakdown,
} from "./quotaModes.js";
import { proxyAwareFetch } from "../common/proxyFetch.ts";
import {
  GROK_CLI_BASE_URL,
  GROK_CLI_USER_AGENT,
  GROK_CLI_TOKEN_AUTH,
  GROK_CLI_AUTHENTICATE_RESPONSE,
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_CLIENT_MODE,
  GROK_CLI_VERSION,
} from "../providers/config/grokCli.ts";
import { decodeGrokCreditsFrame } from "./usage/grokCliQuotaFrame.js";

const REFRESH_SCAN_MS = 30_000;
const RECOVERY_SCAN_MS = 60_000;
const RATE_LIMIT_CLEANUP_MS = 5 * 60_000;
const MAX_CONCURRENT_REFRESHES = 4;
const MAX_RECOVERY_ATTEMPTS = 5;
const GRPC_CREDITS_URL = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
const GRPC_WEB_EMPTY_REQUEST_FRAME = Buffer.from([0, 0, 0, 0, 0]);

export interface QuotaTrackerOptions {
  runtime: Runtime;
}

export interface QuotaSnapshot {
  connectionId: string;
  windows: QuotaWindowRecord[];
  rateLimited: boolean;
  rateLimitResetAt: string | null;
  lastRateLimitEvent: RateLimitEventRecord | null;
}

export interface RateLimitInfo {
  statusCode: number;
  retryAfter: number | null;
  resetAt: string | null;
  message: string | null;
}

export class QuotaTracker {
  private runtime: Runtime;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private refreshingConnections = new Set<string>();

  constructor(options: QuotaTrackerOptions) {
    this.runtime = options.runtime;
  }

  start(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => this.scanDueWindows().catch(() => {}), REFRESH_SCAN_MS);
    this.refreshTimer.unref?.();
    this.recoveryTimer = setInterval(() => this.scanDueRecoveries().catch(() => {}), RECOVERY_SCAN_MS);
    this.recoveryTimer.unref?.();
    this.cleanupTimer = setInterval(() => this.cleanupOldRateLimitEvents().catch(() => {}), RATE_LIMIT_CLEANUP_MS);
    this.cleanupTimer.unref?.();
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.refreshTimer = null;
    this.recoveryTimer = null;
    this.cleanupTimer = null;
  }

  getSnapshot(connectionId: string): QuotaSnapshot {
    const windows = this.runtime.repos.quotaWindows.list(connectionId);
    const rateLimitEvents = this.runtime.repos.rateLimitEvents.list(connectionId, 1);
    const lastEvent = rateLimitEvents[0] || null;
    const rateLimited = lastEvent !== null && this.isRateLimitActive(lastEvent);
    return {
      connectionId,
      windows,
      rateLimited,
      rateLimitResetAt: lastEvent?.resetAt || null,
      lastRateLimitEvent: lastEvent,
    };
  }

  getQuotaWindow(connectionId: string, mode: QuotaModeValue): QuotaWindowRecord | null {
    return this.runtime.repos.quotaWindows.get(connectionId, mode);
  }

  isQuotaAvailable(connectionId: string, mode: QuotaModeValue): boolean {
    if (this.isRateLimited(connectionId)) return false;
    const window = this.getQuotaWindow(connectionId, mode);
    if (!window) return true;
    return window.remaining > 0;
  }

  isRateLimited(connectionId: string): boolean {
    const events = this.runtime.repos.rateLimitEvents.list(connectionId, 1);
    const lastEvent = events[0];
    return !!lastEvent && this.isRateLimitActive(lastEvent);
  }

  private isRateLimitActive(event: RateLimitEventRecord): boolean {
    if (!event.resetAt) return false;
    const resetTime = new Date(event.resetAt).getTime();
    return Date.now() < resetTime;
  }

  recordRateLimit(connectionId: string, mode: QuotaModeValue | null, info: RateLimitInfo): void {
    this.runtime.repos.rateLimitEvents.create({
      connectionId,
      mode,
      statusCode: info.statusCode,
      retryAfter: info.retryAfter,
      resetAt: info.resetAt,
      message: info.message,
    });
    if (mode) {
      this.markQuotaExhausted(connectionId, mode);
    }
  }

  private markQuotaExhausted(connectionId: string, mode: QuotaModeValue): void {
    const window = this.getQuotaWindow(connectionId, mode);
    if (window) {
      this.runtime.repos.quotaWindows.upsert({
        ...window,
        remaining: 0,
        usagePercent: 100,
      });
    }
    this.scheduleRecovery(connectionId, mode);
  }

  decrementQuota(connectionId: string, mode: QuotaModeValue, amount: number = 1): QuotaWindowRecord | null {
    return this.runtime.repos.quotaWindows.decrement(connectionId, mode, amount);
  }

  saveQuotaWindows(connectionId: string, windows: Array<Omit<QuotaWindowRecord, "connectionId" | "updatedAt">>): void {
    for (const window of windows) {
      this.runtime.repos.quotaWindows.upsert({
        connectionId,
        ...window,
      });
    }
  }

  private scheduleRecovery(connectionId: string, mode: QuotaModeValue): void {
    const existing = this.runtime.repos.quotaRecovery.getByConnection(connectionId, mode);
    if (existing) return;
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    this.runtime.repos.quotaRecovery.create({
      id: crypto.randomUUID(),
      connectionId,
      mode,
      dueAt,
      attempts: 0,
      claimToken: crypto.randomUUID(),
    });
  }

  private async scanDueWindows(): Promise<void> {
    const now = new Date().toISOString();
    const dueWindows = this.runtime.repos.quotaWindows.listDue(now, 100);
    const connectionIds = [...new Set(dueWindows.map(w => w.connectionId))];
    for (const connectionId of connectionIds) {
      if (this.refreshingConnections.size >= MAX_CONCURRENT_REFRESHES) break;
      this.refreshConnectionQuota(connectionId).catch(() => {});
    }
  }

  private async scanDueRecoveries(): Promise<void> {
    const now = new Date().toISOString();
    const dueRecoveries = this.runtime.repos.quotaRecovery.listDue(now, 50);
    for (const recovery of dueRecoveries) {
      if (recovery.attempts >= MAX_RECOVERY_ATTEMPTS) {
        this.runtime.repos.quotaRecovery.remove(recovery.id);
        continue;
      }
      this.attemptRecovery(recovery).catch(() => {});
    }
  }

  private async cleanupOldRateLimitEvents(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.runtime.repos.rateLimitEvents.removeOlderThan(cutoff);
  }

  async refreshConnectionQuota(connectionId: string): Promise<void> {
    if (this.refreshingConnections.has(connectionId)) return;
    this.refreshingConnections.add(connectionId);
    try {
      const connection = this.runtime.repos.providers.get(connectionId);
      if (!connection || connection.provider !== "grok-cli") return;
      const accessToken = connection.credentials?.accessToken as string;
      if (!accessToken) return;
      const windows = await this.fetchQuotaWindows(accessToken, connection.credentials as Record<string, any>);
      this.saveQuotaWindows(connectionId, windows);
    } finally {
      this.refreshingConnections.delete(connectionId);
    }
  }

  private async fetchQuotaWindows(accessToken: string, providerSpecificData: Record<string, any>): Promise<Array<Omit<QuotaWindowRecord, "connectionId" | "updatedAt">>> {
    const windows: Array<Omit<QuotaWindowRecord, "connectionId" | "updatedAt">> = [];
    const headers = this.buildBillingHeaders(accessToken, providerSpecificData);
    try {
      const [billingRes, userRes] = await Promise.all([
        proxyAwareFetch(`${GROK_CLI_BASE_URL}/billing?format=credits`, { method: "GET", headers }, null),
        proxyAwareFetch(`${GROK_CLI_BASE_URL}/user?include=subscription`, { method: "GET", headers }, null).catch(() => null),
      ]);
      if (!billingRes.ok) return windows;
      const billing = await billingRes.json().catch(() => null) as any;
      const user = userRes?.ok ? await userRes.json().catch(() => null) as any : null;
      windows.push(...this.parseBillingToWindows(billing, user));
      const grpcWindows = await this.fetchGrpcCreditsWindows(accessToken);
      windows.push(...grpcWindows);
    } catch {
    }
    return windows;
  }

  private buildBillingHeaders(accessToken: string, providerSpecificData: Record<string, any>): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": GROK_CLI_USER_AGENT,
      "x-xai-token-auth": GROK_CLI_TOKEN_AUTH,
      "x-authenticateresponse": GROK_CLI_AUTHENTICATE_RESPONSE,
      "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
      "x-grok-client-version": GROK_CLI_VERSION,
      "x-grok-client-mode": GROK_CLI_CLIENT_MODE,
    };
    const email = providerSpecificData?.email;
    const userId = providerSpecificData?.userId || providerSpecificData?.principalId;
    if (email) headers["x-email"] = String(email);
    if (userId) headers["x-userid"] = String(userId);
    return headers;
  }

  private parseBillingToWindows(billing: any, user: any): Array<Omit<QuotaWindowRecord, "connectionId" | "updatedAt">> {
    const windows: Array<Omit<QuotaWindowRecord, "connectionId" | "updatedAt">> = [];
    const config = billing?.config || billing || {};
    const now = new Date().toISOString();
    const periodEnd = config.billingPeriodEnd || config.currentPeriod?.end || null;
    const monthlyLimit = this.unwrapVal(config.monthlyLimit);
    const used = this.unwrapVal(config.used ?? config.totalUsed ?? config.includedUsed);
    if (monthlyLimit > 0) {
      windows.push({
        mode: QuotaMode.Weekly,
        remaining: Math.max(0, monthlyLimit - used),
        total: monthlyLimit,
        usagePercent: (used / monthlyLimit) * 100,
        breakdown: this.parseBreakdown(config),
        windowSeconds: 7 * 24 * 60 * 60,
        resetAt: periodEnd,
        syncedAt: now,
        source: QuotaSource.Upstream,
      });
    }
    const onDemandCap = this.unwrapVal(config.onDemandCap);
    const onDemandUsed = this.unwrapVal(config.onDemandUsed);
    if (onDemandCap > 0) {
      windows.push({
        mode: QuotaMode.Fast,
        remaining: Math.max(0, onDemandCap - onDemandUsed),
        total: onDemandCap,
        usagePercent: (onDemandUsed / onDemandCap) * 100,
        breakdown: [],
        windowSeconds: 7 * 24 * 60 * 60,
        resetAt: periodEnd,
        syncedAt: now,
        source: QuotaSource.Upstream,
      });
    }
    const creditUsagePercent = this.unwrapVal(config.creditUsagePercent);
    if (creditUsagePercent > 0 && creditUsagePercent < 100) {
      windows.push({
        mode: QuotaMode.DailyAllowance,
        remaining: Math.max(0, 100 - creditUsagePercent),
        total: 100,
        usagePercent: creditUsagePercent,
        breakdown: [],
        windowSeconds: 24 * 60 * 60,
        resetAt: periodEnd,
        syncedAt: now,
        source: QuotaSource.Upstream,
      });
    }
    return windows;
  }

  private parseBreakdown(config: any): QuotaBreakdown[] {
    const breakdown: QuotaBreakdown[] = [];
    const productUsage = config.productUsage || config.breakdown || [];
    if (Array.isArray(productUsage)) {
      for (const item of productUsage) {
        if (item && typeof item === "object") {
          const productCode = Number(item.productCode ?? item.code ?? 0);
          const usagePercent = Number(item.usagePercent ?? item.percent ?? 0);
          breakdown.push({ productCode, usagePercent });
        }
      }
    }
    return breakdown;
  }

  private async fetchGrpcCreditsWindows(accessToken: string): Promise<Array<Omit<QuotaWindowRecord, "connectionId" | "updatedAt">>> {
    const windows: Array<Omit<QuotaWindowRecord, "connectionId" | "updatedAt">> = [];
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
        null,
      );
      if (!res?.ok) return windows;
      const arrayBuffer = await res.arrayBuffer().catch(() => null);
      if (!arrayBuffer) return windows;
      const decoded = decodeGrokCreditsFrame(Buffer.from(arrayBuffer));
      if (decoded && typeof decoded.percentUsed === "number") {
        windows.push({
          mode: QuotaMode.Weekly,
          remaining: Math.max(0, 100 - decoded.percentUsed),
          total: 100,
          usagePercent: decoded.percentUsed,
          breakdown: [],
          windowSeconds: 7 * 24 * 60 * 60,
          resetAt: decoded.resetAt || null,
          syncedAt: new Date().toISOString(),
          source: QuotaSource.Upstream,
        });
      }
    } catch {
    }
    return windows;
  }

  private unwrapVal(value: any, fallback = 0): number {
    if (value == null) return fallback;
    if (typeof value === "object" && !Array.isArray(value) && "val" in value) {
      return Number(value.val) || fallback;
    }
    return Number(value) || fallback;
  }

  private async attemptRecovery(recovery: QuotaRecoveryRecord): Promise<void> {
    this.runtime.repos.quotaRecovery.incrementAttempts(recovery.id);
    const connection = this.runtime.repos.providers.get(recovery.connectionId);
    if (!connection) {
      this.runtime.repos.quotaRecovery.remove(recovery.id);
      return;
    }
    const accessToken = connection.credentials?.accessToken as string;
    if (!accessToken) {
      this.runtime.repos.quotaRecovery.remove(recovery.id);
      return;
    }
    try {
      await this.refreshConnectionQuota(recovery.connectionId);
      const window = this.getQuotaWindow(recovery.connectionId, recovery.mode as QuotaModeValue);
      if (window && window.remaining > 0) {
        this.runtime.repos.quotaRecovery.remove(recovery.id);
      }
    } catch {
    }
  }

  parseRateLimitFromResponse(statusCode: number, headers: Headers, bodyText: string): RateLimitInfo {
    const retryAfter = headers.get("retry-after");
    const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
    const resetAt = retryAfterSeconds ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString() : null;
    let message: string | null = null;
    try {
      const parsed = JSON.parse(bodyText);
      message = parsed?.error?.message || parsed?.message || parsed?.error || null;
    } catch {
      message = bodyText?.slice(0, 500) || null;
    }
    return {
      statusCode,
      retryAfter: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
      resetAt,
      message,
    };
  }

  isQuotaExhaustedError(statusCode: number, bodyText: string): boolean {
    if (statusCode === 429) return true;
    if (statusCode === 402) {
      const lower = bodyText.toLowerCase();
      return lower.includes("spending-limit") || lower.includes("run out of credits") || lower.includes("usage limit");
    }
    return false;
  }

  extractQuotaModeFromRequest(body: any): QuotaModeValue | null {
    if (!body || typeof body !== "object") return null;
    if (body._compact === true) return QuotaMode.Weekly;
    return QuotaMode.Weekly;
  }
}

let singleton: QuotaTracker | null = null;

export function getQuotaTracker(): QuotaTracker | null {
  return singleton;
}

export function initQuotaTracker(runtime: Runtime): QuotaTracker {
  if (singleton) return singleton;
  singleton = new QuotaTracker({ runtime });
  return singleton;
}
