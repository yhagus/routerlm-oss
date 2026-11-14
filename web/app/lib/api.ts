/**
 * A message to show for a failed dashboard API call: the backend's
 * `message` (one string, or one per invalid field), or `fallback`.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = readProperty(readProperty(error, "data"), "message");
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message) && message.every((part) => typeof part === "string")) {
    return message.join(" ");
  }
  return fallback;
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}
