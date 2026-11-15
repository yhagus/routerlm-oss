import { type IQueryHandler, QueryBus, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { ListQuotaMetersQuery } from "@/quota-meters/queries/impl/list-quota-meters.query.js";
import { CooldownStore } from "../../providers/cooldown-store.js";
import { providerAccountColumns } from "../../models/provider-account.js";
import {
  type ListedProviderAccount,
  ListProviderAccountsQuery,
} from "../impl/list-provider-accounts.query.js";

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
    return accounts.map((account) => ({
      ...account,
      cooldownEndsAt: cooldowns.get(account.id)?.endsAt ?? null,
      cooldownCause: cooldowns.get(account.id)?.cause ?? null,
      quotaMeters: quotaMeters.get(account.id) ?? [],
    }));
  }
}
