import { Query } from "@nestjs/cqrs";
import type { User } from "@/users/models/user.js";

/**
 * The User whose password this is, or `null`. Answers in the same time
 * whether or not the email exists, so callers can't tell the two apart.
 */
export class FindUserByCredentialsQuery extends Query<User | null> {
  constructor(
    readonly email: string,
    readonly password: string,
  ) {
    super();
  }
}
