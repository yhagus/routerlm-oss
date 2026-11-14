import { Command } from "@nestjs/cqrs";
import type { User } from "../../models/user.js";
import type { NewUser } from "../../schemas/new-user.schema.js";

/** Creates the first User. Refused once any User exists. */
export class CreateFirstUserCommand extends Command<User> {
  constructor(readonly newUser: NewUser) {
    super();
  }
}
