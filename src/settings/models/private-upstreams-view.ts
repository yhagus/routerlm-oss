import type { SettingValue } from '@/settings/providers/settings-store';
import type { PrivateUpstreamsSetting } from './private-upstreams';
import { SETTING_DEFINITIONS } from './setting-definitions';

const { default: defaultAllowed } = SETTING_DEFINITIONS.allowPrivateUpstreams;

export function toPrivateUpstreamsSetting({
  value,
  isDefault,
}: SettingValue<boolean>): PrivateUpstreamsSetting {
  return { allowed: value, defaultAllowed, isDefault };
}
