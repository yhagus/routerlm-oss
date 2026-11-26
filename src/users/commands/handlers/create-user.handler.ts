import { PasswordHasher } from '@nestjs/authentication';
import { ConflictException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import { users } from '@/db/schemas';
import { normalizeEmail, type User, userColumns } from '@/users/models/user';
import { CreateUserCommand } from '@/users/commands/impl/create-user.command';

const UNIQUE_VIOLATION = '23505';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute({ newUser, createdById }: CreateUserCommand): Promise<User> {
    const passwordHash = await this.passwordHasher.hash(newUser.password);
    try {
      const [created] = await this.db
        .insert(users)
        .values({ email: normalizeEmail(newUser.email), passwordHash, createdById })
        .returning(userColumns);
      return created;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A User with this email already exists');
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const driverError = error.cause ?? error;
  return (
    typeof driverError === 'object' &&
    driverError !== null &&
    'code' in driverError &&
    driverError.code === UNIQUE_VIOLATION
  );
}
