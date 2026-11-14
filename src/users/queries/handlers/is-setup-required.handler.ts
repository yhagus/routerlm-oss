import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "../../../db/schemas/relations.js";
import { users } from "../../../db/schemas/index.js";
import { IsSetupRequiredQuery } from "../impl/is-setup-required.query.js";

@QueryHandler(IsSetupRequiredQuery)
export class IsSetupRequiredHandler implements IQueryHandler<IsSetupRequiredQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute(): Promise<boolean> {
    const [existing] = await this.db.select({ id: users.id }).from(users).limit(1);
    return existing === undefined;
  }
}
