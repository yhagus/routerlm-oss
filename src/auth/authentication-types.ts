import type { User } from "../users/models/user.js";

// Types `@CurrentUser()` as our User, and the User DrizzleSessionStore joins
// onto each session it reads (`SessionRecord.extra`).
declare module "@nestjs/authentication" {
  interface AuthenticationTypes {
    user: User;
    sessionExtra: { user: User };
  }
}
