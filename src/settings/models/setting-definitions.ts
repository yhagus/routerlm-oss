import { z } from "zod";

/** Every Setting: adding one is one entry here and one in SETTING_VALUE_SCHEMAS. */
export const SETTING_DEFINITIONS = {
  errorCaptureRetentionDays: { default: 7, min: 1, max: 365 },
  allowTermsRiskProviders: { default: false },
  allowPrivateUpstreams: { default: false },
} as const;

const { min: retentionMin, max: retentionMax } = SETTING_DEFINITIONS.errorCaptureRetentionDays;

/** The values a Setting accepts: an integer inside its range, or a boolean. */
const SETTING_VALUE_SCHEMAS = {
  errorCaptureRetentionDays: z.int().min(retentionMin).max(retentionMax),
  allowTermsRiskProviders: z.boolean(),
  allowPrivateUpstreams: z.boolean(),
} as const satisfies Record<keyof typeof SETTING_DEFINITIONS, z.ZodType>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export type SettingValueOf<Key extends SettingKey> = z.infer<(typeof SETTING_VALUE_SCHEMAS)[Key]>;

export type IntegerSettingKey = {
  [Key in SettingKey]: SettingValueOf<Key> extends number ? Key : never;
}[SettingKey];

export type BooleanSettingKey = {
  [Key in SettingKey]: SettingValueOf<Key> extends boolean ? Key : never;
}[SettingKey];

export function settingValueSchema<Key extends SettingKey>(
  key: Key,
): (typeof SETTING_VALUE_SCHEMAS)[Key] {
  return SETTING_VALUE_SCHEMAS[key];
}
