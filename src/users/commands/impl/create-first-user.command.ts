import { Command } from "@nestjs/cqrs";
import type { User } from "@/users/models/user.js";
import type { NewUser } from "@/users/schemas/new-user.schema.js";

export class CreateFirstUserCommand extends Command<User> {
  constructor(readonly newUser: NewUser) {
    super();
  }
}
