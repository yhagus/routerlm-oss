import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { users } from "@/db/schemas";
import { type User, userColumns } from "@/users/models/user";
import { ListUsersQuery } from "@/users/queries/impl/list-users.query";

@QueryHandler(ListUsersQuery)
export class ListUsersHandler implements IQueryHandler<ListUsersQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute(): Promise<User[]> {
    return this.db.select(userColumns).from(users).orderBy(asc(users.createdAt));
  }
}
