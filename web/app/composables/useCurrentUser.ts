import type { User } from "~/lib/users";

/**
 * The signed-in User: `undefined` until the auth middleware has asked the
 * backend, then the User, or `null` when signed out.
 */
export function useCurrentUser() {
  return useState<User | null | undefined>("current-user", () => undefined);
}
