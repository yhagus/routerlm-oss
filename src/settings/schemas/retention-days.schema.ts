import { z } from "zod";
import { settingValueSchema } from "../models/setting-definitions.js";

const retentionDaysSchema = settingValueSchema("errorCaptureRetentionDays");

export const newRetentionSchema = z.object({ days: retentionDaysSchema });
export type NewRetention = z.infer<typeof newRetentionSchema>;

export const retentionImpactQuerySchema = z.object({
  days: z.coerce.number().pipe(retentionDaysSchema),
});
export type RetentionImpactQuery = z.infer<typeof retentionImpactQuerySchema>;
