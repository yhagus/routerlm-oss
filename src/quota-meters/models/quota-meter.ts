import { asc, inArray } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { type providerAccounts, quotaMeters } from "@/db/schemas/index.js";

/** One Quota Meter as a quota reader reads it, before it is stored for a Provider Account. */
export type QuotaMeterReading = Omit<
  typeof quotaMeters.$inferSelect,
  "id" | "providerAccountId" | "observedAt"
>;

/** What a reading stores for each meter, besides the account and key that identify it. */
const readingColumns = {
  label: quotaMeters.label,
  unit: quotaMeters.unit,
  used: quotaMeters.used,
  limit: quotaMeters.limit,
  remainingPercent: quotaMeters.remainingPercent,
  isUnlimited: quotaMeters.isUnlimited,
  windowSeconds: quotaMeters.windowSeconds,
  resetsAt: quotaMeters.resetsAt,
  scope: quotaMeters.scope,
  observedAt: quotaMeters.observedAt,
};

/** The columns a new reading overwrites in a meter row: the Provider's raw entry too. */
export const overwrittenQuotaMeterColumns = { ...readingColumns, raw: quotaMeters.raw };

/** The columns the dashboard API returns for a Quota Meter; the Provider's raw entry stays internal. */
const quotaMeterColumns = {
  providerAccountId: quotaMeters.providerAccountId,
  key: quotaMeters.key,
  ...readingColumns,
};

/** A Quota Meter as the dashboard API returns it. */
export type QuotaMeter = Omit<typeof quotaMeters.$inferSelect, "id" | "providerAccountId" | "raw">;

/** A Provider Account's quota status: its latest Quota Meters and how the last reading went. */
export type ProviderAccountQuota = Pick<
  typeof providerAccounts.$inferSelect,
  "quotaCheckedAt" | "quotaError"
> & { quotaMeters: QuotaMeter[] };

/** The Quota Meters of each of the Provider Accounts, ordered by key; an account without any maps to none. */
export async function selectQuotaMeters(
  db: Database,
  providerAccountIds: string[],
): Promise<Map<string, QuotaMeter[]>> {
  const metersByAccount = new Map<string, QuotaMeter[]>();
  if (providerAccountIds.length === 0) {
    return metersByAccount;
  }
  const rows = await db
    .select(quotaMeterColumns)
    .from(quotaMeters)
    .where(inArray(quotaMeters.providerAccountId, providerAccountIds))
    .orderBy(asc(quotaMeters.key));
  for (const { providerAccountId, ...meter } of rows) {
    const meters = metersByAccount.get(providerAccountId) ?? [];
    meters.push(meter);
    metersByAccount.set(providerAccountId, meters);
  }
  return metersByAccount;
}
