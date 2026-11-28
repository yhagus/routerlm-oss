import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import type { ModelChoice } from '@/api-keys/models/api-key';
import { ListModelChoicesQuery } from '@/api-keys/queries/impl/list-model-choices.query';

@QueryHandler(ListModelChoicesQuery)
export class ListModelChoicesHandler implements IQueryHandler<ListModelChoicesQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<ModelChoice[]> {
    return this.db
      .select({ id: models.id, name: models.name, displayName: models.displayName })
      .from(models)
      .orderBy(asc(models.name));
  }
}
