import { Query } from "@nestjs/cqrs";
import type { User } from "@/users/models/user.js";

export class FindUserByCredentialsQuery extends Query<User | null> {
  constructor(
    readonly email: string,
    readonly password: string,
  ) {
    super();
  }
}
