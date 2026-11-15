import { createError, type NuxtError } from "#app";

const NOT_FOUND = 404;

/** The dashboard records a detail page can fail to find. */
export type MissingResource = "Provider" | "Model" | "Error Capture";

/** What the error page says about a record that isn't there. */
const MISSING_RESOURCE_HINTS = {
  Provider: "It may have been deleted, along with its Provider Accounts and Upstream Models.",
  Model: "It may have been deleted or renamed. Clients asking for it now get an error.",
  "Error Capture": "It may have passed the retention period and been removed.",
} as const satisfies Record<MissingResource, string>;

interface MissingResourceData {
  resource: MissingResource;
}

/**
 * The 404 a detail page raises for a record that doesn't exist. Its message is
 * fixed text: the backend's message can name the record's id, which the
 * dashboard never shows.
 */
export function missingResourceError(resource: MissingResource): NuxtError {
  return createError({
    statusCode: NOT_FOUND,
    statusMessage: "Not Found",
    message: `This ${resource} doesn't exist.`,
    data: { resource } satisfies MissingResourceData,
    fatal: true,
  });
}

/** True for a dashboard API error that answered 404. */
export function isNotFound(error: unknown): boolean {
  return readProperty(error, "statusCode") === NOT_FOUND;
}

/** The record a 404 from `missingResourceError` was about, or undefined for any other error. */
export function missingResourceOf(error: unknown): MissingResource | undefined {
  const resource = readProperty(readProperty(error, "data"), "resource");
  return isMissingResource(resource) ? resource : undefined;
}

function isMissingResource(value: unknown): value is MissingResource {
  return typeof value === "string" && Object.hasOwn(MISSING_RESOURCE_HINTS, value);
}

export function missingResourceHint(resource: MissingResource): string {
  return MISSING_RESOURCE_HINTS[resource];
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}
