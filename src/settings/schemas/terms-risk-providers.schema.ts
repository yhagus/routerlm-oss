import { z } from 'zod';
import { settingValueSchema } from '@/settings/models/setting-definitions';

export const newTermsRiskProvidersSchema = z.object({
  allowed: settingValueSchema('allowTermsRiskProviders'),
});
export type NewTermsRiskProviders = z.infer<typeof newTermsRiskProvidersSchema>;
