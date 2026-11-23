import { Query } from "@nestjs/cqrs";
import type { AttemptFailureReason } from "@/db/schemas/index.js";
import type { QuotaMeter } from "@/quota-meters/queries/impl/list-quota-meters.query.js";
import type { UsageReset } from "@/quota-meters/queries/impl/list-usage-resets.query.js";
import type { ProviderAccount } from "@/upstream/models/provider-account.js";

/**
 * A Provider Account in the dashboard's list, with when its Cooldown ends and
 * what caused it (both null when not in one; cause `exhausted` while
 * Exhausted, until its Quota Meter resets), its latest Quota Meters, and its
 * unexpired Usage Resets (null when its Provider has none).
 */
export type ListedProviderAccount = ProviderAccount & {
  cooldownEndsAt: Date | null;
  cooldownCause: AttemptFailureReason | null;
  quotaMeters: QuotaMeter[];
  usageResets: UsageReset[] | null;
};

/** Every Provider Account, by Provider and then by priority, with its Cooldown, Quota Meters and Usage Resets. */
export class ListProviderAccountsQuery extends Query<ListedProviderAccount[]> {}
