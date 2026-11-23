import { asc, eq, type SQL } from "drizzle-orm";
import type { PricingWindowRange } from "@/db/schemas/index.js";
import { pricingWindows, upstreamModelPricingWindows } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";
import { isPricingWindowActiveAt } from "./pricing-window-activity.js";

/**
 * One Pricing Window an Upstream Model attaches, as the dashboard shows it.
 * Its prices are the Window Prices; a null one is the standard price.
 */
export interface AttachedPricingWindow extends UpstreamModelPrices {
  pricingWindowId: string;
  name: string;
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
  isActiveNow: boolean;
}

/** One Pricing Window an Upstream Model attaches, as stored. */
export type AttachedPricingWindowRow = Omit<AttachedPricingWindow, "isActiveNow"> & {
  upstreamModelId: string;
};

/** A transaction, or the database itself. */
type Reader = Pick<Database, "select">;

/**
 * The attachments `filter` selects (all when undefined), in each Upstream
 * Model's order. The snapshot and the dashboard both read them this way.
 */
export function selectAttachedPricingWindows(
  db: Reader,
  filter?: SQL,
): Promise<AttachedPricingWindowRow[]> {
  return db
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
    .where(filter)
    .orderBy(asc(upstreamModelPricingWindows.position));
}

/**
 * The Pricing Windows of the Upstream Models `upstreamModelFilter` selects (all
 * when undefined), in each model's order, keyed by the Upstream Model's row id.
 */
export async function readAttachedPricingWindows(
  db: Reader,
  upstreamModelFilter?: SQL,
): Promise<Map<string, AttachedPricingWindow[]>> {
  const rows = await selectAttachedPricingWindows(db, upstreamModelFilter);

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
  const rows = await selectAttachedPricingWindows(
    db,
    eq(upstreamModelPricingWindows.upstreamModelId, upstreamModelId),
  );
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
