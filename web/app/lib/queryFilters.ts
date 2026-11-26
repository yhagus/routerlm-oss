export const PLAYGROUND = 'playground';
const SHORT_ID_LENGTH = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FilterOption {
  value: string;
  label: string;
}

export function isUuid(value: string): value is string {
  return UUID_PATTERN.test(value);
}

export function isApiKeyChoice(value: string): value is string {
  return value === PLAYGROUND || isUuid(value);
}

export function missingOptions(
  picked: readonly string[],
  known: readonly FilterOption[],
): FilterOption[] {
  return picked
    .filter((id) => !known.some((option) => option.value === id))
    .map((id) => ({ value: id, label: `${id.slice(0, SHORT_ID_LENGTH)} (not found)` }));
}

export function listParam(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined;
}
