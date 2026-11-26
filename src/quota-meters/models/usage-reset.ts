import { and, asc, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { usageResets } from "@/db/schemas";
import {
  CredentialUnavailableError,
  OauthLoginRefusedError,
  type ProviderAccountCredential,
} from "@/upstream/models/provider-account-credential";
import { type QuotaReaderProvider, QuotaReadError } from "./quota-reader";

export type UsageResetReading = Omit<
  typeof usageResets.$inferSelect,
  "id" | "providerAccountId" | "observedAt"
>;

export type UsageReset = Pick<
  typeof usageResets.$inferSelect,
  "id" | "title" | "grantedAt" | "expiresAt"
>;

export interface UsageResetToSpend {
  externalId: string;
  idempotencyKey: string;
}

export type UsageResetOutcome = "reset" | "nothing-to-reset" | "unavailable";

export interface UsageResetPort {
  list(
    credential: ProviderAccountCredential,
    provider: QuotaReaderProvider,
  ): Promise<UsageResetReading[]>;
  use(
    credential: ProviderAccountCredential,
    provider: QuotaReaderProvider,
    spend: UsageResetToSpend,
  ): Promise<UsageResetOutcome>;
}

export function isUsageResetCallFailure(error: unknown): error is Error {
  return (
    error instanceof QuotaReadError ||
    error instanceof OauthLoginRefusedError ||
    error instanceof CredentialUnavailableError
  );
}

export function isUnexpired(now: Date): SQL | undefined {
  return or(isNull(usageResets.expiresAt), gt(usageResets.expiresAt, now));
}

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
    .orderBy(asc(usageResets.expiresAt), asc(usageResets.grantedAt));
  for (const { providerAccountId, ...reset } of rows) {
    const resets = resetsByAccount.get(providerAccountId) ?? [];
    resets.push(reset);
    resetsByAccount.set(providerAccountId, resets);
  }
  return resetsByAccount;
}
