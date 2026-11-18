/**
 * For parsed JSON, true exactly when `z.object` takes the value as an object:
 * anything but null and arrays. The stream parsers' hand-written fast paths
 * check shapes with it, so they never accept a value their zod schema rejects.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
