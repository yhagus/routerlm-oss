/** The API Key filter's choice for the Playground's requests, which have no API Key. */
export const PLAYGROUND = "playground";
/** Characters of an id shown for an option that a link names but no longer exists. */
const SHORT_ID_LENGTH = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FilterOption {
  value: string;
  label: string;
}

/** Model, API Key and Provider Account ids are UUIDs; the backend rejects anything else. */
export function isUuid(value: string): value is string {
  return UUID_PATTERN.test(value);
}

/** An API Key filter pick: an API Key id, or the Playground. */
export function isApiKeyChoice(value: string): value is string {
  return value === PLAYGROUND || isUuid(value);
}

/** A link can name an option since deleted: show it so it can be unchecked. */
export function missingOptions(
  picked: readonly string[],
  known: readonly FilterOption[],
): FilterOption[] {
  return picked
    .filter((id) => !known.some((option) => option.value === id))
    .map((id) => ({ value: id, label: `${id.slice(0, SHORT_ID_LENGTH)} (not found)` }));
}

/** The picks as one comma-separated param, or none: the backend rejects an empty list. */
export function listParam(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}
