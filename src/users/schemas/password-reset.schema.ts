import { z } from "zod";
import { passwordSchema } from "./password.schema.js";

export const passwordResetSchema = z.object({ password: passwordSchema });
export type PasswordReset = z.infer<typeof passwordResetSchema>;
