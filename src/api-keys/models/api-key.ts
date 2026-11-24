export interface ModelChoice {
  id: string;
  name: string;
}

export interface AllowedModel {
  id: string;
  name: string | null;
}

export const API_KEY_CIPHER_PURPOSE = "api-key";

export interface ApiKeySummary {
  id: string;
  name: string;
  keyId: string;
  createdBy: { id: string; email: string } | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  allowedModels: AllowedModel[];
  isCopyable: boolean;
  lastRotatedAt: Date | null;
  integration: { id: string; name: string } | null;
  customerId: string | null;
  spendLimit: number | null;
  spent: number;
  requestRate: number | null;
}

export interface ApiKeyRotation {
  id: string;
  rotatedAt: Date;
  rotatedBy: { id: string; email: string } | null;
  previousKeyId: string;
  newKeyId: string;
}

export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

export interface KeyCustomer {
  integrationId: string;
  integrationName: string;
  integrationAllowedModelIds: string[];
  customerId: string;
}

export interface ApiKeyPrincipal {
  apiKeyId: string;
  apiKeyName: string;
  allowedModelIds: string[];
  customer: KeyCustomer | null;
  spendLimit: number | null;
  requestRate: number | null;
}

export function mayUseModel(principal: ApiKeyPrincipal, modelId: string): boolean {
  const ceiling = principal.customer?.integrationAllowedModelIds ?? [];
  return allowsModel(principal.allowedModelIds, modelId) && allowsModel(ceiling, modelId);
}

function allowsModel(allowedModelIds: string[], modelId: string): boolean {
  return allowedModelIds.length === 0 || allowedModelIds.includes(modelId);
}
