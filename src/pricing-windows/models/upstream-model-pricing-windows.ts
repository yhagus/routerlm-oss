import { asc, eq, type SQL } from "drizzle-orm";
import type { PricingWindowRange } from "@/db/schemas/index.js";
import { pricingWindows, upstreamModelPricingWindows } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { isPricingWindowActiveAt } from "./pricing-window-activity.js";

/** The token prices an Upstream Model charges while a Pricing Window is active; null is the standard price. */
export interface WindowPrices {
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
}

/** One Pricing Window an Upstream Model attaches, as the dashboard shows it. */
export interface AttachedPricingWindow extends WindowPrices {
  pricingWindowId: string;
  name: string;
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
  isActiveNow: boolean;
}

/** A transaction, or the database itself. */
type Reader = Pick<Database, "select">;

/**
 * The Pricing Windows of the Upstream Models `upstreamModelFilter` selects (all
 * when undefined), in each model's order, keyed by the Upstream Model's row id.
 */
export async function readAttachedPricingWindows(
  db: Reader,
  upstreamModelFilter?: SQL,
): Promise<Map<string, AttachedPricingWindow[]>> {
  const rows = await db
    .select({
      upstreamModelId: upstreamModelPricingWindows.upstreamModelId,
      pricingWindowId: pricingWindows.id,
      name: pricingWindows.name,
      timeZone: pricingWindows.timeZone,
      ranges: pricingWindows.ranges,
      isEnabled: pricingWindows.isEnabled,
      inputPrice: upstreamModelPricingWindows.inputPrice,
      outputPrice: upstreamModelPricingWindows.outputPrice,
      cacheReadPrice: upstreamModelPricingWindows.cacheReadPrice,
      cacheWritePrice: upstreamModelPricingWindows.cacheWritePrice,
    })
    .from(upstreamModelPricingWindows)
    .innerJoin(pricingWindows, eq(pricingWindows.id, upstreamModelPricingWindows.pricingWindowId))
    .where(upstreamModelFilter)
    .orderBy(asc(upstreamModelPricingWindows.position));

  const now = new Date();
  const windowsByUpstreamModelId = new Map<string, AttachedPricingWindow[]>();
  for (const { upstreamModelId, ...window } of rows) {
    const windows = windowsByUpstreamModelId.get(upstreamModelId) ?? [];
    windows.push({ ...window, isActiveNow: isPricingWindowActiveAt(window, now) });
    windowsByUpstreamModelId.set(upstreamModelId, windows);
  }
  return windowsByUpstreamModelId;
}

/** The names of the Pricing Windows the Upstream Model attaches, in its order. */
export async function attachedPricingWindowNames(
  db: Reader,
  upstreamModelId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: pricingWindows.name })
    .from(upstreamModelPricingWindows)
    .innerJoin(pricingWindows, eq(pricingWindows.id, upstreamModelPricingWindows.pricingWindowId))
    .where(eq(upstreamModelPricingWindows.upstreamModelId, upstreamModelId))
    .orderBy(asc(upstreamModelPricingWindows.position));
  return rows.map((row) => row.name);
}

/** The Pricing Windows the Upstream Model attaches, in its order. */
export async function readPricingWindowsOf(
  db: Reader,
  upstreamModelId: string,
): Promise<AttachedPricingWindow[]> {
  const windowsByUpstreamModelId = await readAttachedPricingWindows(
    db,
    eq(upstreamModelPricingWindows.upstreamModelId, upstreamModelId),
  );
  return windowsByUpstreamModelId.get(upstreamModelId) ?? [];
}
