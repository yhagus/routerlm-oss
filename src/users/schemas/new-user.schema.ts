import { z } from "zod";
import { passwordSchema } from "./password.schema.js";

/** Email and password of a new User: first-run setup, and creating a User from the dashboard. */
export const newUserSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: passwordSchema,
});
export type NewUser = z.infer<typeof newUserSchema>;
