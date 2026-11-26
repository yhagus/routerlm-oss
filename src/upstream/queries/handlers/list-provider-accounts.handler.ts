import { type IQueryHandler, QueryBus, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { providerAccounts } from "@/db/schemas";
import { ListQuotaMetersQuery } from "@/quota-meters/queries/impl/list-quota-meters.query";
import { ListUsageResetsQuery } from "@/quota-meters/queries/impl/list-usage-resets.query";
import { CooldownStore } from "@/upstream/providers/cooldown-store";
import { providerAccountColumns } from "@/upstream/models/provider-account";
import {
  type ListedProviderAccount,
  ListProviderAccountsQuery,
} from "@/upstream/queries/impl/list-provider-accounts.query";

@QueryHandler(ListProviderAccountsQuery)
export class ListProviderAccountsHandler implements IQueryHandler<ListProviderAccountsQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly cooldowns: CooldownStore,
    private readonly queryBus: QueryBus,
  ) {}

  async execute(): Promise<ListedProviderAccount[]> {
    const accounts = await this.db
      .select(providerAccountColumns)
      .from(providerAccounts)
      .orderBy(asc(providerAccounts.providerId), asc(providerAccounts.priority));
    const accountIds = accounts.map((account) => account.id);
    const cooldowns = await this.cooldowns.cooldowns(accountIds);
    const quotaMeters = await this.queryBus.execute(new ListQuotaMetersQuery(accountIds));
    const usageResets = await this.queryBus.execute(new ListUsageResetsQuery(accountIds));
    return accounts.map((account) => ({
      ...account,
      cooldownEndsAt: cooldowns.get(account.id)?.endsAt ?? null,
      cooldownCause: cooldowns.get(account.id)?.cause ?? null,
      quotaMeters: quotaMeters.get(account.id) ?? [],
      usageResets: usageResets.get(account.id) ?? null,
    }));
  }
}
