import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import { selectUsageResets, type UsageReset } from "@/quota-meters/models/usage-reset.js";
import { UsageResetTargets } from "@/quota-meters/providers/usage-reset-targets.js";
import { ListUsageResetsQuery } from "@/quota-meters/queries/impl/list-usage-resets.query.js";

@QueryHandler(ListUsageResetsQuery)
export class ListUsageResetsHandler implements IQueryHandler<ListUsageResetsQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly targets: UsageResetTargets,
  ) {}

  async execute({ providerAccountIds }: ListUsageResetsQuery): Promise<Map<string, UsageReset[]>> {
    const supporting = await this.targets.withUsageResets(providerAccountIds);
    const stored = await selectUsageResets(this.db, supporting);
    return new Map(supporting.map((id) => [id, stored.get(id) ?? []]));
  }
}
