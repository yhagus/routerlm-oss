import { z } from "zod";
import { settingValueSchema } from "../models/setting-definitions.js";

export const newTermsRiskProvidersSchema = z.object({
  allowed: settingValueSchema("allowTermsRiskProviders"),
});
export type NewTermsRiskProviders = z.infer<typeof newTermsRiskProvidersSchema>;
