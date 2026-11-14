import { PasswordHasher } from "@nestjs/authentication";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { users } from "@/db/schemas/index.js";
import { normalizeEmail, type User, userColumns } from "../../models/user.js";
import { FindUserByCredentialsQuery } from "../impl/find-user-by-credentials.query.js";

@QueryHandler(FindUserByCredentialsQuery)
export class FindUserByCredentialsHandler implements IQueryHandler<FindUserByCredentialsQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute({ email, password }: FindUserByCredentialsQuery): Promise<User | null> {
    const [found] = await this.db
      .select({ ...userColumns, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)));
    const isPasswordCorrect = await this.passwordHasher.verify(password, found?.passwordHash);
    if (!found || !isPasswordCorrect) {
      return null;
    }
    const { passwordHash: _passwordHash, ...user } = found;
    return user;
  }
}
