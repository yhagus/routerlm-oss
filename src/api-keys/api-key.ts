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

/** An API Key as the dashboard lists it: never the key itself, nor its hash. */
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
}

/** A just-created API Key: the only response that ever carries the whole key. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

/** Who a request signed in with an API Key acts as. */
export interface ApiKeyPrincipal {
  /** The `api_keys` row id (not the public key id), as Usage Logs reference it. */
  apiKeyId: string;
  /** Empty means every Model. */
  allowedModelIds: string[];
}

/** Whether a client signed in with this API Key may call the Model. */
export function mayUseModel(principal: ApiKeyPrincipal, modelId: string): boolean {
  return principal.allowedModelIds.length === 0 || principal.allowedModelIds.includes(modelId);
}
