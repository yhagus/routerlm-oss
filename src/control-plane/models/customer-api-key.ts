/**
 * An API Key an Integration issued to one of its Customers, as the control
 * plane shows it to that Integration (ApiKey in control_plane.proto). Never the key itself.
 */
export interface CustomerApiKey {
  id: string;
  /** The public id inside the key (`rlm_<keyId>_<secret>`). */
  keyId: string;
  name: string;
  customerId: string;
  createdAt: Date;
  /** Null means the key never expires. */
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** Empty means every Model the Integration may sell. */
  allowedModelIds: string[];
  /** USD. Null means no Spend Limit. */
  spendLimit: number | null;
  /** USD counted against the Spend Limit. */
  spent: number;
  /** Requests per minute. Null means no limit. */
  requestRate: number | null;
}

/** A Customer's API Key just created or rotated, with the whole key (IssuedKey). */
export interface IssuedCustomerApiKey {
  apiKey: CustomerApiKey;
  key: string;
}

/** One page of an Integration's API Keys, newest first (ListKeysResponse). */
export interface CustomerApiKeyPage {
  keys: CustomerApiKey[];
  /** Null on the last page. */
  nextPageToken: string | null;
}
