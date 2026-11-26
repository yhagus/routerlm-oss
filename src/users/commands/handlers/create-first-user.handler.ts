import { PasswordHasher } from '@nestjs/authentication';
import { ConflictException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import { users } from '@/db/schemas';
import { lockUsers } from '@/users/models/lock-users';
import { normalizeEmail, type User, userColumns } from '@/users/models/user';
import { CreateFirstUserCommand } from '@/users/commands/impl/create-first-user.command';

@CommandHandler(CreateFirstUserCommand)
export class CreateFirstUserHandler implements ICommandHandler<CreateFirstUserCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute({ newUser }: CreateFirstUserCommand): Promise<User> {
    const passwordHash = await this.passwordHasher.hash(newUser.password);
    return this.db.transaction(async (tx) => {
      await lockUsers(tx);
      const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing) {
        throw new ConflictException('Setup is already complete');
      }
      const [created] = await tx
        .insert(users)
        .values({ email: normalizeEmail(newUser.email), passwordHash })
        .returning(userColumns);
      return created;
    });
  }
}
