import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { selectQuotaMeters } from "@/quota-meters/models/quota-meter.js";
import { CooldownStore } from "../../providers/cooldown-store.js";
import {
  type ListedProviderAccount,
  providerAccountColumns,
} from "../../models/provider-account.js";
import { ListProviderAccountsQuery } from "../impl/list-provider-accounts.query.js";

@QueryHandler(ListProviderAccountsQuery)
export class ListProviderAccountsHandler implements IQueryHandler<ListProviderAccountsQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly cooldowns: CooldownStore,
  ) {}

  async execute(): Promise<ListedProviderAccount[]> {
    const accounts = await this.db
      .select(providerAccountColumns)
      .from(providerAccounts)
      .orderBy(asc(providerAccounts.providerId), asc(providerAccounts.priority));
    const accountIds = accounts.map((account) => account.id);
    const cooldowns = await this.cooldowns.cooldowns(accountIds);
    const quotaMeters = await selectQuotaMeters(this.db, accountIds);
    return accounts.map((account) => ({
      ...account,
      cooldownEndsAt: cooldowns.get(account.id)?.endsAt ?? null,
      quotaMeters: quotaMeters.get(account.id) ?? [],
    }));
  }
}
