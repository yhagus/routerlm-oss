import { asc, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, quotaMeters } from '@/db/schemas';
import type { UsageReset } from './usage-reset';

export type QuotaMeterReading = Omit<
  typeof quotaMeters.$inferSelect,
  'id' | 'providerAccountId' | 'observedAt'
>;

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

export const overwrittenQuotaMeterColumns = { ...readingColumns, raw: quotaMeters.raw };

const quotaMeterColumns = {
  providerAccountId: quotaMeters.providerAccountId,
  key: quotaMeters.key,
  ...readingColumns,
};

export type QuotaMeter = Omit<typeof quotaMeters.$inferSelect, 'id' | 'providerAccountId' | 'raw'>;

export type ProviderAccountQuota = Pick<
  typeof providerAccounts.$inferSelect,
  'quotaCheckedAt' | 'quotaError'
> & { quotaMeters: QuotaMeter[]; usageResets: UsageReset[] | null };

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

export async function recordQuotaError(
  db: Database,
  providerAccountId: string,
  { error, checkedAt }: { error: string; checkedAt: Date },
): Promise<void> {
  await db
    .update(providerAccounts)
    .set({ quotaCheckedAt: checkedAt, quotaError: error })
    .where(eq(providerAccounts.id, providerAccountId));
}
