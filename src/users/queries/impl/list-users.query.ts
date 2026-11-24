import { Query } from "@nestjs/cqrs";
import type { User } from "@/users/models/user.js";

export class ListUsersQuery extends Query<User[]> {}
