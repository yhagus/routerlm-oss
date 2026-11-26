import { ConflictException } from '@nestjs/common';
import type { pricingWindows } from '@/db/schemas';
import { hasPostgresErrorCode, UNIQUE_VIOLATION } from '@/libs/models/postgres-errors';

export type PricingWindow = typeof pricingWindows.$inferSelect;

export interface PricingWindowSummary extends PricingWindow {
  isActiveNow: boolean;
  attachedUpstreamModelCount: number;
}

export function toPricingWindowWriteError(error: unknown, name: string | undefined): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(`A Pricing Window named "${name ?? ''}" already exists`);
  }
  return error;
}
