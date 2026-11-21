/** The largest Spend Limit in USD (spend_limit is numeric(18, 10)), as the backend's `MAX_SPEND_LIMIT_USD` says. */
export const MAX_SPEND_LIMIT_USD = 99_999_999;

/** The largest Request Rate in requests per minute (an int32), as the backend's `MAX_REQUEST_RATE` says. */
export const MAX_REQUEST_RATE = 2_147_483_647;

/** A Model the API Key form offers. */
export interface ModelChoice {
  id: string;
  name: string;
}

/** An API Key as the dashboard API lists it: never the key itself. */
export interface ApiKeySummary {
  id: string;
  name: string;
  /** The public id inside the key, `rlm_<keyId>_<secret>`. */
  keyId: string;
  /** Null when the User who created it was deleted. */
  createdBy: { id: string; email: string } | null;
  createdAt: string;
  /** Null means the key never expires. */
  expiresAt: string | null;
  revokedAt: string | null;
  /** Empty means every Model. A `null` name is a Model that was deleted. */
  allowedModels: { id: string; name: string | null }[];
  /**
   * Whether `GET /api-keys/:id/key` can show the key again. False for a revoked
   * key and for one created before keys were stored encrypted (ADR 0029).
   */
  isCopyable: boolean;
  /** When the key was last rotated; null if never. Older rotations were not recorded. */
  lastRotatedAt: string | null;
  /** The Integration that issued the key; null for a key a User created. */
  integration: { id: string; name: string } | null;
  /** The id its Integration gives the Customer; null for a key a User created. */
  customerId: string | null;
  /** USD. Null means no Spend Limit. */
  spendLimit: number | null;
  /** USD of Cost counted against the Spend Limit so far. */
  spent: number;
  /** Requests per minute. Null means no Request Rate. */
  requestRate: number | null;
}

/** One rotation, as `GET /api-keys/:id/rotations` lists them, newest first. */
export interface ApiKeyRotation {
  id: string;
  rotatedAt: string;
  /** Null when the User who rotated it was deleted. */
  rotatedBy: { id: string; email: string } | null;
  /** The public key id that stopped working. */
  previousKeyId: string;
  /** The public key id that replaced it. */
  newKeyId: string;
}

/** The create and rotate responses: the key itself, ready to copy. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

/**
 * An Integration's key belongs to what that Integration sold its Customer: the
 * dashboard may only revoke it, and the backend refuses edits and rotations.
 */
export function isIntegrationOwned(apiKey: ApiKeySummary): boolean {
  return apiKey.integration !== null;
}

export type ApiKeyStatus = "active" | "expired" | "revoked";

export function apiKeyStatus(apiKey: ApiKeySummary, now: number): ApiKeyStatus {
  if (apiKey.revokedAt) return "revoked";
  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now) return "expired";
  return "active";
}

/** The ISO time a key picked to expire on `date` (`YYYY-MM-DD`) stops working: the end of that local day. */
export function endOfLocalDay(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

/** A date picker value (`YYYY-MM-DD`, local) for a stored expiry, or "" for none. */
export function localDateOf(expiresAt: string | null): string {
  return expiresAt ? new Date(expiresAt).toLocaleDateString("en-CA") : "";
}
