import { Command } from '@nestjs/cqrs';
import type { User } from '@/users/models/user';
import type { NewUser } from '@/users/schemas/new-user.schema';

export class CreateUserCommand extends Command<User> {
  constructor(
    readonly newUser: NewUser,
    readonly createdById: string,
  ) {
    super();
  }
}
