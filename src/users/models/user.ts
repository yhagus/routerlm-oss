import { users } from "@/db/schemas/index.js";

/** A User as the app passes it around: the `users` row without its password hash. */
export type User = Omit<typeof users.$inferSelect, "passwordHash">;

/** The `users` columns that make up a {@link User}, for `db.select(userColumns)`. */
export const userColumns = {
  id: users.id,
  email: users.email,
  createdById: users.createdById,
  createdAt: users.createdAt,
};

/** Emails are unique as stored, so every address is normalised before it is written or looked up. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
