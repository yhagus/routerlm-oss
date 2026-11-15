import { Query } from "@nestjs/cqrs";
import type { AttemptFailureReason } from "@/db/schemas/index.js";
import type { QuotaMeter } from "@/quota-meters/queries/impl/list-quota-meters.query.js";
import type { ProviderAccount } from "../../models/provider-account.js";

/**
 * A Provider Account in the dashboard's list, with when its Cooldown ends and
 * what caused it (both null when not in one; cause `exhausted` while
 * Exhausted, until its Quota Meter resets), and its latest Quota Meters.
 */
export type ListedProviderAccount = ProviderAccount & {
  cooldownEndsAt: Date | null;
  cooldownCause: AttemptFailureReason | null;
  quotaMeters: QuotaMeter[];
};

/** Every Provider Account, by Provider and then by priority, with its Cooldown and Quota Meters. */
export class ListProviderAccountsQuery extends Query<ListedProviderAccount[]> {}
