import { PasswordHasher } from '@nestjs/authentication';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { users } from '@/db/schemas';
import { normalizeEmail, type User, userColumns } from '@/users/models/user';
import { FindUserByCredentialsQuery } from '@/users/queries/impl/find-user-by-credentials.query';

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
