import { eq, type SQL } from "drizzle-orm";
import type { PricingWindowRange } from "@/db/schemas/index.js";
import { pricingWindows, upstreamModelPricingWindows } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import type { UpstreamModelPrices } from "@/usage/models/usage-job.js";
import { type WindowPricesStatus, windowPricesStatusAt } from "./pricing-window-activity.js";
import { type ValidityPeriod, validityInstantsOf } from "./validity-period.js";

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
  status: WindowPricesStatus;
}

/** One Pricing Window an Upstream Model attaches, as stored. */
export type AttachedPricingWindowRow = Omit<AttachedPricingWindow, "status"> & {
  upstreamModelId: string;
};

/** A transaction, or the database itself. */
type Reader = Pick<Database, "select">;

/**
 * The attachments `filter` selects (all when undefined), by the instant their
 * Validity Period starts (open start first), then window name. The snapshot
 * and the dashboard both read them this way.
 */
export async function selectAttachedPricingWindows(
  db: Reader,
  filter?: SQL,
): Promise<AttachedPricingWindowRow[]> {
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
      validFrom: upstreamModelPricingWindows.validFrom,
      validUntil: upstreamModelPricingWindows.validUntil,
    })
    .from(upstreamModelPricingWindows)
    .innerJoin(pricingWindows, eq(pricingWindows.id, upstreamModelPricingWindows.pricingWindowId))
    .where(filter);
  // Sorted here, not in SQL: the stored starts are wall-clock text in each
  // window's own time zone, so only their instants compare across zones.
  return rows.sort(compareByStartThenName);
}

function compareByStartThenName(
  first: AttachedPricingWindowRow,
  second: AttachedPricingWindowRow,
): number {
  const firstStart = startInMillisecondsOf(first);
  const secondStart = startInMillisecondsOf(second);
  if (firstStart !== secondStart) {
    return firstStart < secondStart ? -1 : 1;
  }
  return first.name.localeCompare(second.name);
}

/** When the attachment's Validity Period starts; an open start comes before every other. */
function startInMillisecondsOf(attachment: AttachedPricingWindowRow): number {
  const { start } = validityInstantsOf(attachment, attachment.timeZone);
  return start === null ? Number.NEGATIVE_INFINITY : start.getTime();
}

/**
 * The attachments of the Upstream Models `upstreamModelFilter` selects (all
 * when undefined), in `selectAttachedPricingWindows` order, keyed by the
 * Upstream Model's row id.
 */
export async function selectAttachmentsByUpstreamModelId(
  db: Reader,
  upstreamModelFilter?: SQL,
): Promise<Map<string, AttachedPricingWindowRow[]>> {
  const attachmentsByUpstreamModelId = new Map<string, AttachedPricingWindowRow[]>();
  for (const attachment of await selectAttachedPricingWindows(db, upstreamModelFilter)) {
    const modelAttachments = attachmentsByUpstreamModelId.get(attachment.upstreamModelId) ?? [];
    modelAttachments.push(attachment);
    attachmentsByUpstreamModelId.set(attachment.upstreamModelId, modelAttachments);
  }
  return attachmentsByUpstreamModelId;
}

/**
 * The Pricing Windows of the Upstream Models `upstreamModelFilter` selects (all
 * when undefined), as the dashboard shows them, keyed by the Upstream Model's
 * row id.
 */
export async function readAttachedPricingWindows(
  db: Reader,
  upstreamModelFilter?: SQL,
): Promise<Map<string, AttachedPricingWindow[]>> {
  const attachmentsByUpstreamModelId = await selectAttachmentsByUpstreamModelId(
    db,
    upstreamModelFilter,
  );
  const now = new Date();
  const windowsByUpstreamModelId = new Map<string, AttachedPricingWindow[]>();
  for (const [upstreamModelId, attachments] of attachmentsByUpstreamModelId) {
    windowsByUpstreamModelId.set(
      upstreamModelId,
      attachments.map((attachment) => attachedPricingWindowAt(attachment, now)),
    );
  }
  return windowsByUpstreamModelId;
}

function attachedPricingWindowAt(
  { upstreamModelId: _upstreamModelId, ...window }: AttachedPricingWindowRow,
  now: Date,
): AttachedPricingWindow {
  return { ...window, status: windowPricesStatusAt(window, now) };
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
