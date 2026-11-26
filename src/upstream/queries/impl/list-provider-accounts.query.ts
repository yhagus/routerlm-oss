import { Query } from '@nestjs/cqrs';
import type { AttemptFailureReason } from '@/db/schemas';
import type { QuotaMeter } from '@/quota-meters/queries/impl/list-quota-meters.query';
import type { UsageReset } from '@/quota-meters/queries/impl/list-usage-resets.query';
import type { ProviderAccount } from '@/upstream/models/provider-account';

export type ListedProviderAccount = ProviderAccount & {
  cooldownEndsAt: Date | null;
  cooldownCause: AttemptFailureReason | null;
  quotaMeters: QuotaMeter[];
  usageResets: UsageReset[] | null;
};

export class ListProviderAccountsQuery extends Query<ListedProviderAccount[]> {}
