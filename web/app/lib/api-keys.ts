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
}

/** The create response: the only time the whole key is ever shown. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
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
