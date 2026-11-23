import { and, asc, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { usageResets } from "@/db/schemas/index.js";
import {
  CredentialUnavailableError,
  OauthLoginRefusedError,
  type ProviderAccountCredential,
} from "@/upstream/models/provider-account-credential.js";
import { type QuotaReaderProvider, QuotaReadError } from "./quota-reader.js";

/** One Usage Reset as the Provider lists it, before it is stored for a Provider Account. */
export type UsageResetReading = Omit<
  typeof usageResets.$inferSelect,
  "id" | "providerAccountId" | "observedAt"
>;

/** A Usage Reset as the dashboard API returns it; `id` is ours, not the Provider's. */
export type UsageReset = Pick<
  typeof usageResets.$inferSelect,
  "id" | "title" | "grantedAt" | "expiresAt"
>;

/**
 * How the Provider answered spending a Usage Reset: it restored the meters,
 * no meter was low enough to restore, or the reset is spent or gone.
 */
export type UsageResetOutcome = "reset" | "nothing-to-reset" | "unavailable";

/**
 * What a quota reader whose Provider has Usage Resets also does. Both methods
 * throw QuotaReadError when the Provider refuses, times out or answers
 * something unreadable.
 */
export interface UsageResetPort {
  /** Every Usage Reset the account can still spend. */
  list(
    credential: ProviderAccountCredential,
    provider: QuotaReaderProvider,
  ): Promise<UsageResetReading[]>;
  /**
   * Spends one Usage Reset. The Provider spends it at most once per
   * `idempotencyKey`, so the operator's retry of one click is safe.
   */
  use(
    credential: ProviderAccountCredential,
    provider: QuotaReaderProvider,
    spend: { externalId: string; idempotencyKey: string },
  ): Promise<UsageResetOutcome>;
}

/**
 * Whether a call for Usage Resets failed at the Provider or for want of a
 * credential, rather than through a bug.
 */
export function isUsageResetCallFailure(error: unknown): error is Error {
  return (
    error instanceof QuotaReadError ||
    error instanceof OauthLoginRefusedError ||
    error instanceof CredentialUnavailableError
  );
}

/** Stored resets the account can still spend: those without an expiry, or expiring later. */
export function isUnexpired(now: Date): SQL | undefined {
  return or(isNull(usageResets.expiresAt), gt(usageResets.expiresAt, now));
}

/**
 * The unexpired Usage Resets of each of the Provider Accounts, soonest expiry
 * first and never-expiring last; an account without any is absent.
 */
export async function selectUsageResets(
  db: Database,
  providerAccountIds: string[],
): Promise<Map<string, UsageReset[]>> {
  const resetsByAccount = new Map<string, UsageReset[]>();
  if (providerAccountIds.length === 0) {
    return resetsByAccount;
  }
  const rows = await db
    .select({
      providerAccountId: usageResets.providerAccountId,
      id: usageResets.id,
      title: usageResets.title,
      grantedAt: usageResets.grantedAt,
      expiresAt: usageResets.expiresAt,
    })
    .from(usageResets)
    .where(and(inArray(usageResets.providerAccountId, providerAccountIds), isUnexpired(new Date())))
    // Postgres sorts nulls last in ascending order: never-expiring resets come last.
    .orderBy(asc(usageResets.expiresAt), asc(usageResets.grantedAt));
  for (const { providerAccountId, ...reset } of rows) {
    const resets = resetsByAccount.get(providerAccountId) ?? [];
    resets.push(reset);
    resetsByAccount.set(providerAccountId, resets);
  }
  return resetsByAccount;
}
