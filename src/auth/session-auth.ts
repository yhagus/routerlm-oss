import {
  AuthenticationRegistry,
  SessionCookieProvider,
  type SessionRecord,
} from "@nestjs/authentication";
import { Injectable } from "@nestjs/common";
import type { User } from "../users/user.js";

/** Signs dashboard Users in with the session cookie. */
@Injectable()
export class SessionAuth extends SessionCookieProvider<User> {
  constructor(registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this);
  }

  // DrizzleSessionStore joins the User onto the session; a deleted User reads as no session.
  protected validate(session: SessionRecord): User | null {
    return session.extra?.user ?? null;
  }
}
