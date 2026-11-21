/** A Model as the API Key form offers it. */
export interface ModelChoice {
  id: string;
  name: string;
}

/**
 * A Model an API Key is restricted to. `name` is null once the Model is
 * deleted: the key stays restricted to it rather than widening to all Models.
 */
export interface AllowedModel {
  id: string;
  name: string | null;
}

/**
 * Authenticates the encrypted copy of an API Key, so it never decrypts as a
 * Provider Account key or any other secret ProviderKeyCipher holds.
 */
export const API_KEY_CIPHER_PURPOSE = "api-key";

/** An API Key as the dashboard lists it: never the key itself, its hash, nor its ciphertext. */
export interface ApiKeySummary {
  id: string;
  name: string;
  /** The public id inside the key (`rlm_<keyId>_<secret>`), to tell keys apart. */
  keyId: string;
  /** Null when the User who created it was deleted. */
  createdBy: { id: string; email: string } | null;
  createdAt: Date;
  /** Null means the key never expires. */
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** Empty means every Model. */
  allowedModels: AllowedModel[];
  /** Whether the whole key can be shown again: false for revoked keys and keys made before keys were kept. */
  isCopyable: boolean;
  /** Null when the key was never rotated (or only before rotations were recorded). */
  lastRotatedAt: Date | null;
}

/** One rotation of an API Key: which public key id stopped working and which replaced it. */
export interface ApiKeyRotation {
  id: string;
  rotatedAt: Date;
  /** Null when the User who rotated it was deleted. */
  rotatedBy: { id: string; email: string } | null;
  previousKeyId: string;
  newKeyId: string;
}

/** A just-created or just-rotated API Key, with the whole key. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

/** The Integration that issued an API Key, and the Customer it issued it to. */
export interface KeyCustomer {
  integrationId: string;
  /** As named when the snapshot was loaded, for the request's Usage Log. */
  integrationName: string;
  /** The Integration's allowed Models, the ceiling of its keys'. Empty means every Model. */
  integrationAllowedModelIds: string[];
  customerId: string;
}

/** Who a request signed in with an API Key acts as. */
export interface ApiKeyPrincipal {
  /** The `api_keys` row id (not the public key id), as Usage Logs reference it. */
  apiKeyId: string;
  /** As named when the snapshot was loaded, for the request's Usage Log. */
  apiKeyName: string;
  /** Empty means every Model (within the Integration's, for a Customer's key). */
  allowedModelIds: string[];
  /** Null for a key a User created. */
  customer: KeyCustomer | null;
}

/**
 * Whether a client signed in with this API Key may call the Model: within the
 * key's allowed Models and, for a Customer's key, its Integration's too.
 */
export function mayUseModel(principal: ApiKeyPrincipal, modelId: string): boolean {
  const ceiling = principal.customer?.integrationAllowedModelIds ?? [];
  return allowsModel(principal.allowedModelIds, modelId) && allowsModel(ceiling, modelId);
}

/** Whether an allowed-Models list lets the Model through; empty lets every Model through. */
function allowsModel(allowedModelIds: string[], modelId: string): boolean {
  return allowedModelIds.length === 0 || allowedModelIds.includes(modelId);
}
