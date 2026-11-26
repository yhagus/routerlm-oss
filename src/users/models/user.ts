import { users } from '@/db/schemas';

export type User = Omit<typeof users.$inferSelect, 'passwordHash'>;

export const userColumns = {
  id: users.id,
  email: users.email,
  createdById: users.createdById,
  createdAt: users.createdAt,
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
