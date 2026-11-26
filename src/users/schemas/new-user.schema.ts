import { z } from "zod";
import { passwordSchema } from "./password.schema";

export const newUserSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: passwordSchema,
});
export type NewUser = z.infer<typeof newUserSchema>;
