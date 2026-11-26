import type { User } from "@/users/models/user";

declare module "@nestjs/authentication" {
  interface AuthenticationTypes {
    user: User;
    sessionExtra: { user: User };
  }
}
