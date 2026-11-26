import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from "@nestjs/authentication";
import { Injectable } from "@nestjs/common";
import type { User } from "@/users/models/user";

@Injectable()
export class SessionAuth extends SessionCookieProvider<User> {
  constructor(registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this);
  }

  protected validate(session: SessionRecord): User | null {
    return session.extra?.user ?? null;
  }
}
