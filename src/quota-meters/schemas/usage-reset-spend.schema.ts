import { z } from "zod";

/** What spending a Usage Reset takes: a key the dashboard makes once per click, so a retry spends nothing more. */
export const usageResetSpendSchema = z.strictObject({ idempotencyKey: z.uuid() });

export type UsageResetSpend = z.infer<typeof usageResetSpendSchema>;
