import { z } from 'zod';

export const usageResetSpendSchema = z.strictObject({ idempotencyKey: z.uuid() });

export type UsageResetSpend = z.infer<typeof usageResetSpendSchema>;
