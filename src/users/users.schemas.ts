import { z } from "zod";

// What `PasswordHasher` accepts is up to 4 KiB of UTF-8; 1024 characters stay under it.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

/** Email and password of a new User: first-run setup, and creating a User from the dashboard. */
export const newUserSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: passwordSchema,
});
export type NewUser = z.infer<typeof newUserSchema>;

export const passwordResetSchema = z.object({ password: passwordSchema });
export type PasswordReset = z.infer<typeof passwordResetSchema>;
