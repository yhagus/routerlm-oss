import { Command } from "@nestjs/cqrs";
import type { User } from "@/users/models/user.js";
import type { NewUser } from "@/users/schemas/new-user.schema.js";

/** Creates the first User. Refused once any User exists. */
export class CreateFirstUserCommand extends Command<User> {
  constructor(readonly newUser: NewUser) {
    super();
  }
}
