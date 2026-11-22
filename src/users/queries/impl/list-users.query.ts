import { Query } from "@nestjs/cqrs";
import type { User } from "@/users/models/user.js";

/** Every User, oldest first. */
export class ListUsersQuery extends Query<User[]> {}
