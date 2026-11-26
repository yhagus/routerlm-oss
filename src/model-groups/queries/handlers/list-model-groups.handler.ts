import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc, eq, getColumns } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { modelGroupMembers, modelGroups } from '@/db/schemas';
import type { ModelGroupSummary } from '@/model-groups/models/model-group';
import { ListModelGroupsQuery } from '@/model-groups/queries/impl/list-model-groups.query';

@QueryHandler(ListModelGroupsQuery)
export class ListModelGroupsHandler implements IQueryHandler<ListModelGroupsQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<ModelGroupSummary[]> {
    return this.db
      .select({
        ...getColumns(modelGroups),
        modelCount: this.db.$count(
          modelGroupMembers,
          eq(modelGroupMembers.modelGroupId, modelGroups.id),
        ),
      })
      .from(modelGroups)
      .orderBy(asc(modelGroups.name));
  }
}
