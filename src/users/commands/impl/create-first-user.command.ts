import { Command } from '@nestjs/cqrs';
import type { User } from '@/users/models/user';
import type { NewUser } from '@/users/schemas/new-user.schema';

export class CreateFirstUserCommand extends Command<User> {
  constructor(readonly newUser: NewUser) {
    super();
  }
}
