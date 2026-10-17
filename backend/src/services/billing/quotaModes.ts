/**
 * Quota modes for Grok CLI / Grok Build
 * 
 * Mirrors grok2api's quota mode system for multi-pool tracking.
 */

export const QuotaMode = {
  Weekly: "weekly",
  Fast: "fast",
  Console: "console",
  ConsoleImage: "console_image",
  WebImagePro: "image_pro",
  WebImageEdit: "image_edit",
  WebVideo: "video",
  WebVideo720p: "video_720p",
  DailyAllowance: "daily_allowance",
} as const;

export type QuotaModeValue = typeof QuotaMode[keyof typeof QuotaMode];

export const QuotaGroup = {
  WebImagine: "web_imagine",
} as const;

export type QuotaGroupValue = typeof QuotaGroup[keyof typeof QuotaGroup];

export const QuotaSource = {
  Default: "default",
  Estimated: "estimated",
  Upstream: "upstream",
} as const;

export type QuotaSourceValue = typeof QuotaSource[keyof typeof QuotaSource];

export const QuotaProduct = {
  ThirdParty: 0,
  API: 1,
  Build: 2,
  Plugins: 3,
  Chat: 4,
  Imagine: 5,
  Voice: 6,
} as const;

export interface QuotaBreakdown {
  productCode: number;
  usagePercent: number;
}

export interface QuotaWindow {
  accountId: string;
  mode: QuotaModeValue;
  remaining: number;
  total: number;
  usagePercent: number;
  breakdown: QuotaBreakdown[];
  windowSeconds: number;
  resetAt: string | null;
  syncedAt: string | null;
  source: QuotaSourceValue;
  updatedAt: string;
}

export interface QuotaRecoveryEvent {
  accountId: string;
  mode: QuotaModeValue;
  dueAt: string;
  attempts: number;
  claimToken: string;
}

export function isWebImagineQuotaMode(mode: string): boolean {
  const webImagineModes: readonly string[] = [
    QuotaMode.WebImagePro,
    QuotaMode.WebImageEdit,
    QuotaMode.WebVideo,
    QuotaMode.WebVideo720p,
  ];
  return webImagineModes.includes(mode);
}

export function webImagineQuotaModes(): QuotaModeValue[] {
  return [
    QuotaMode.WebImagePro,
    QuotaMode.WebImageEdit,
    QuotaMode.WebVideo,
    QuotaMode.WebVideo720p,
  ];
}
