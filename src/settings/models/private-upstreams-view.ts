import type { SettingValue } from "../providers/settings-store.js";
import type { PrivateUpstreamsSetting } from "./private-upstreams.js";
import { SETTING_DEFINITIONS } from "./setting-definitions.js";

const { default: defaultAllowed } = SETTING_DEFINITIONS.allowPrivateUpstreams;

export function toPrivateUpstreamsSetting({
  value,
  isDefault,
}: SettingValue<boolean>): PrivateUpstreamsSetting {
  return { allowed: value, defaultAllowed, isDefault };
}
