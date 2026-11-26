import { createError, type NuxtError } from '#app';

const NOT_FOUND = 404;

export type MissingResource = 'Provider' | 'Model' | 'Error Capture' | 'Usage Log' | 'Integration';

const MISSING_RESOURCE_HINTS = {
  Provider: 'It may have been deleted, along with its Provider Accounts and Upstream Models.',
  Model: 'It may have been deleted or renamed. Clients asking for it now get an error.',
  'Error Capture': 'It may have passed the retention period and been removed.',
  'Usage Log': 'Check the link: no request was recorded with this id.',
  Integration: 'It may have been deleted, which revoked all its API Keys.',
} as const satisfies Record<MissingResource, string>;

interface MissingResourceData {
  resource: MissingResource;
}

export function missingResourceError(resource: MissingResource): NuxtError {
  return createError({
    statusCode: NOT_FOUND,
    statusMessage: 'Not Found',
    message: `This ${resource} doesn't exist.`,
    data: { resource } satisfies MissingResourceData,
    fatal: true,
  });
}

export function isNotFound(error: unknown): boolean {
  return readProperty(error, 'statusCode') === NOT_FOUND;
}

export function missingResourceOf(error: unknown): MissingResource | undefined {
  const resource = readProperty(readProperty(error, 'data'), 'resource');
  return isMissingResource(resource) ? resource : undefined;
}

function isMissingResource(value: unknown): value is MissingResource {
  return typeof value === 'string' && Object.hasOwn(MISSING_RESOURCE_HINTS, value);
}

export function missingResourceHint(resource: MissingResource): string {
  return MISSING_RESOURCE_HINTS[resource];
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}
