import type { SettingValue } from "../providers/settings-store.js";
import type { TermsRiskProvidersSetting } from "./terms-risk-providers.js";
import { SETTING_DEFINITIONS } from "./setting-definitions.js";

const { default: defaultAllowed } = SETTING_DEFINITIONS.allowTermsRiskProviders;

export function toTermsRiskProvidersSetting({
  value,
  isDefault,
}: SettingValue<boolean>): TermsRiskProvidersSetting {
  return { allowed: value, defaultAllowed, isDefault };
}
