import { z } from 'zod';

interface SettingDefinition<Value> {
  default: Value;
  schema: z.ZodType<Value, Value>;
}

interface IntegerRange {
  default: number;
  min: number;
  max: number;
}

function integerSetting(range: IntegerRange): IntegerRange & SettingDefinition<number> {
  return { ...range, schema: z.int().min(range.min).max(range.max) };
}

function booleanSetting(defaultValue: boolean): SettingDefinition<boolean> {
  return { default: defaultValue, schema: z.boolean() };
}

export const SETTING_DEFINITIONS = {
  errorCaptureRetentionDays: integerSetting({ default: 7, min: 1, max: 365 }),
  allowTermsRiskProviders: booleanSetting(false),
  allowPrivateUpstreams: booleanSetting(false),
} as const satisfies Record<string, SettingDefinition<number> | SettingDefinition<boolean>>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

type SettingValueSchemaOf<Key extends SettingKey> = (typeof SETTING_DEFINITIONS)[Key]['schema'];

export type SettingValueOf<Key extends SettingKey> = z.infer<SettingValueSchemaOf<Key>>;

export type IntegerSettingKey = {
  [Key in SettingKey]: SettingValueOf<Key> extends number ? Key : never;
}[SettingKey];

export type BooleanSettingKey = {
  [Key in SettingKey]: SettingValueOf<Key> extends boolean ? Key : never;
}[SettingKey];

export function settingValueSchema<Key extends SettingKey>(key: Key): SettingValueSchemaOf<Key> {
  return SETTING_DEFINITIONS[key].schema;
}
