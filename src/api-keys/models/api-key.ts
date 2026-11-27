import {
  allowsModel,
  EVERY_MODEL,
  type GroupedModel,
  type ModelAllowance,
} from '@/libs/models/allowed-models';

export interface ModelChoice {
  id: string;
  name: string;
}

export interface AllowedModel {
  id: string;
  name: string | null;
}

export interface AllowedModelGroup {
  id: string;
  name: string | null;
}

export const API_KEY_CIPHER_PURPOSE = 'api-key';

export interface ApiKeySummary {
  id: string;
  name: string;
  keyId: string;
  createdBy: { id: string; email: string } | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  allowedModels: AllowedModel[];
  allowedModelGroups: AllowedModelGroup[];
  directUpstreamAccess: boolean;
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
  integrationAllowance: ModelAllowance;
  integrationHasDirectUpstreamAccess: boolean;
  customerId: string;
}

export interface ApiKeyPrincipal extends ModelAllowance {
  apiKeyId: string;
  apiKeyName: string;
  hasDirectUpstreamAccess: boolean;
  customer: KeyCustomer | null;
  spendLimit: number | null;
  requestRate: number | null;
}

export function mayUseModel(principal: ApiKeyPrincipal, model: GroupedModel): boolean {
  const ceiling = principal.customer?.integrationAllowance ?? EVERY_MODEL;
  return allowsModel(principal, model) && allowsModel(ceiling, model);
}

export function mayUseUpstreamModels(principal: ApiKeyPrincipal): boolean {
  const integrationAllows = principal.customer?.integrationHasDirectUpstreamAccess ?? true;
  return principal.hasDirectUpstreamAccess && integrationAllows;
}
