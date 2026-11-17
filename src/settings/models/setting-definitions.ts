import { z } from "zod";

interface IntegerSettingDefinition {
  default: number;
  min: number;
  max: number;
}

/** Every Setting: adding one is one entry here. */
export const SETTING_DEFINITIONS = {
  errorCaptureRetentionDays: { default: 7, min: 1, max: 365 },
} as const satisfies Record<string, IntegerSettingDefinition>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

/** The values a Setting accepts, as an integer inside its range. */
export function settingValueSchema(key: SettingKey) {
  const { min, max } = SETTING_DEFINITIONS[key];
  return z.int().min(min).max(max);
}
