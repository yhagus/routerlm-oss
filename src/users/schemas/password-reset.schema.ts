import { z } from 'zod';
import { passwordSchema } from './password.schema';

export const passwordResetSchema = z.object({ password: passwordSchema });
export type PasswordReset = z.infer<typeof passwordResetSchema>;
