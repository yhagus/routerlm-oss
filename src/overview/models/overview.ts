import type { ErrorOrigin } from '@/db/schemas';

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

export const OVERVIEW_RANGES = ['24h', '7d', '30d'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export const OVERVIEW_BUCKETS = {
  '24h': { bucketSeconds: HOUR_SECONDS, bucketCount: 24 },
  '7d': { bucketSeconds: 6 * HOUR_SECONDS, bucketCount: 28 },
  '30d': { bucketSeconds: DAY_SECONDS, bucketCount: 30 },
} as const satisfies Record<OverviewRange, { bucketSeconds: number; bucketCount: number }>;

export interface OverviewStats {
  requestCount: number;
  cost: number;
  cacheHitRate: number | null;
  errorRate: number | null;
  failedCount: number;
  errorsByOrigin: ErrorsByOrigin;
}

export interface OriginErrors {
  count: number;
  rate: number | null;
}

export type ErrorsByOrigin = Record<ErrorOrigin, OriginErrors>;

export interface OverviewBucket extends OverviewStats {
  start: Date;
}

export interface Overview {
  range: OverviewRange;
  bucketSeconds: number;
  buckets: OverviewBucket[];
  totals: OverviewStats;
  hasUsageLogs: boolean;
}
