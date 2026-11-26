import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import { users } from '@/db/schemas';
import { IsSetupRequiredQuery } from '@/users/queries/impl/is-setup-required.query';

@QueryHandler(IsSetupRequiredQuery)
export class IsSetupRequiredHandler implements IQueryHandler<IsSetupRequiredQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute(): Promise<boolean> {
    const [existing] = await this.db.select({ id: users.id }).from(users).limit(1);
    return existing === undefined;
  }
}
