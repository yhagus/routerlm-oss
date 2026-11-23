import { ConflictException } from "@nestjs/common";
import type { pricingWindows } from "@/db/schemas/index.js";
import { hasPostgresErrorCode, UNIQUE_VIOLATION } from "@/libs/models/postgres-errors.js";

/** A Pricing Window as it is stored. */
export type PricingWindow = typeof pricingWindows.$inferSelect;

/** A Pricing Window as the dashboard lists it. */
export interface PricingWindowSummary extends PricingWindow {
  isActiveNow: boolean;
  /** How many Upstream Models give it Window Prices, so lose them when it is deleted. */
  attachedUpstreamModelCount: number;
}

/** The HTTP error for a failed Pricing Window insert or update, or the original error. */
export function toPricingWindowWriteError(error: unknown, name: string | undefined): unknown {
  if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
    return new ConflictException(`A Pricing Window named "${name ?? ""}" already exists`);
  }
  return error;
}
