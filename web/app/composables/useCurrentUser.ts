import type { User } from '~/lib/users';

export function useCurrentUser() {
  return useState<User | null | undefined>('current-user', () => undefined);
}
