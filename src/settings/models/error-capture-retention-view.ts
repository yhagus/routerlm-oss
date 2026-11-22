import type { ErrorCaptureRetention } from "./error-capture-retention.js";
import { SETTING_DEFINITIONS } from "./setting-definitions.js";
import type { SettingValue } from "@/settings/providers/settings-store.js";

const { default: defaultDays, min, max } = SETTING_DEFINITIONS.errorCaptureRetentionDays;

export function toErrorCaptureRetention({ value, isDefault }: SettingValue): ErrorCaptureRetention {
  return { days: value, defaultDays, isDefault, min, max };
}
