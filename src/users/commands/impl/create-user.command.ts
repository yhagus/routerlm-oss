import { Command } from "@nestjs/cqrs";
import type { User } from "@/users/models/user.js";
import type { NewUser } from "@/users/schemas/new-user.schema.js";

/** Creates a User from the dashboard. Refused when the email is taken. */
export class CreateUserCommand extends Command<User> {
  constructor(
    readonly newUser: NewUser,
    readonly createdById: string,
  ) {
    super();
  }
}
