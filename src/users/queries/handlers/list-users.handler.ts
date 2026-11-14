import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "../../../db/schemas/relations.js";
import { users } from "../../../db/schemas/index.js";
import { type User, userColumns } from "../../models/user.js";
import { ListUsersQuery } from "../impl/list-users.query.js";

@QueryHandler(ListUsersQuery)
export class ListUsersHandler implements IQueryHandler<ListUsersQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<User[]> {
    return this.db.select(userColumns).from(users).orderBy(asc(users.createdAt));
  }
}
