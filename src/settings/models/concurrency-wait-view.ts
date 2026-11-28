import type { ConcurrencyWaitSetting } from './concurrency-wait';
import { SETTING_DEFINITIONS } from './setting-definitions';
import type { SettingValue } from '@/settings/providers/settings-store';

const { default: defaultSeconds, min, max } = SETTING_DEFINITIONS.concurrencyWaitSeconds;

export function toConcurrencyWaitSetting({
  value,
  isDefault,
}: SettingValue): ConcurrencyWaitSetting {
  return { seconds: value, defaultSeconds, isDefault, min, max };
}
