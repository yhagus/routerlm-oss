import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { asc } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { providers } from '@/db/schemas';
import type { Provider } from '@/upstream/models/provider';
import { ListProvidersQuery } from '@/upstream/queries/impl/list-providers.query';

@QueryHandler(ListProvidersQuery)
export class ListProvidersHandler implements IQueryHandler<ListProvidersQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<Provider[]> {
    return this.db.select().from(providers).orderBy(asc(providers.name));
  }
}
