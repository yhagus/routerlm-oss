import { z } from 'zod';
import { settingValueSchema } from '@/settings/models/setting-definitions';

export const newConcurrencyWaitSchema = z.object({
  seconds: settingValueSchema('concurrencyWaitSeconds'),
});
export type NewConcurrencyWait = z.infer<typeof newConcurrencyWaitSchema>;
