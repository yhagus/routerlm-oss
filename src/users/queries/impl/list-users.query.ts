import { Query } from '@nestjs/cqrs';
import type { User } from '@/users/models/user';

export class ListUsersQuery extends Query<User[]> {}
