import { asc, eq, type SQL, sql } from "drizzle-orm";
import type { PricingWindowRange } from "@/db/schemas/index.js";
import { pricingWindows, upstreamModelPricingWindows } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";
import {
  doWindowPricesApplyAt,
  type WindowPricesStatus,
  windowPricesStatusAt,
} from "./pricing-window-activity.js";
import type { ValidityPeriod } from "./validity-period.js";

/**
 * One Pricing Window an Upstream Model attaches, as the dashboard shows it.
 * Its prices are the Window Prices; a null one is the standard price. The
 * same window may be attached several times, for Validity Periods that don't
 * overlap (ADR 0040).
 */
export interface AttachedPricingWindow extends UpstreamModelPrices, ValidityPeriod {
  pricingWindowId: string;
  name: string;
  timeZone: string;
  ranges: PricingWindowRange[];
  isEnabled: boolean;
  /** Whether these Window Prices apply right now: `status` is `active`. */
  isActiveNow: boolean;
  status: WindowPricesStatus;
}

/** One Pricing Window an Upstream Model attaches, as stored. */
export type AttachedPricingWindowRow = Omit<AttachedPricingWindow, "isActiveNow" | "status"> & {
  upstreamModelId: string;
};

/** A transaction, or the database itself. */
type Reader = Pick<Database, "select">;

/**
 * The attachments `filter` selects (all when undefined), by the start of
 * their Validity Period (open start first), then window name. The snapshot
 * and the dashboard both read them this way.
 */
export function selectAttachedPricingWindows(
  db: Reader,
  filter?: SQL,
): Promise<AttachedPricingWindowRow[]> {
  return (
    db
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
        validFrom: upstreamModelPricingWindows.validFrom,
        validUntil: upstreamModelPricingWindows.validUntil,
      })
      .from(upstreamModelPricingWindows)
      .innerJoin(pricingWindows, eq(pricingWindows.id, upstreamModelPricingWindows.pricingWindowId))
      .where(filter)
      // Starts compare as wall-clock times, whatever each window's time zone.
      .orderBy(
        sql`${upstreamModelPricingWindows.validFrom} asc nulls first`,
        asc(pricingWindows.name),
      )
  );
}

/**
 * The Pricing Windows of the Upstream Models `upstreamModelFilter` selects (all
 * when undefined), in `selectAttachedPricingWindows` order, keyed by the
 * Upstream Model's row id.
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
    windows.push({
      ...window,
      isActiveNow: doWindowPricesApplyAt(window, now),
      status: windowPricesStatusAt(window, now),
    });
    windowsByUpstreamModelId.set(upstreamModelId, windows);
  }
  return windowsByUpstreamModelId;
}

/** The names of the Pricing Windows the Upstream Model attaches, each once, in alphabetical order. */
export async function attachedPricingWindowNames(
  db: Reader,
  upstreamModelId: string,
): Promise<string[]> {
  const rows = await selectAttachedPricingWindows(
    db,
    eq(upstreamModelPricingWindows.upstreamModelId, upstreamModelId),
  );
  const names = new Set(rows.map((row) => row.name));
  return [...names].sort((first, second) => first.localeCompare(second));
}

/** The Pricing Windows the Upstream Model attaches, in `selectAttachedPricingWindows` order. */
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
