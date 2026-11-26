import type { SettingValue } from '@/settings/providers/settings-store';
import type { TermsRiskProvidersSetting } from './terms-risk-providers';
import { SETTING_DEFINITIONS } from './setting-definitions';

const { default: defaultAllowed } = SETTING_DEFINITIONS.allowTermsRiskProviders;

export function toTermsRiskProvidersSetting({
  value,
  isDefault,
}: SettingValue<boolean>): TermsRiskProvidersSetting {
  return { allowed: value, defaultAllowed, isDefault };
}
