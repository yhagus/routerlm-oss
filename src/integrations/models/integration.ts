import type { AllowedModel, AllowedModelGroup, ApiKeyRotation } from '@/api-keys/models/api-key';
import type { ModelAllowance } from '@/libs/models/allowed-models';

export interface IntegrationSummary {
  id: string;
  name: string;
  keyId: string;
  createdBy: { id: string; email: string } | null;
  createdAt: Date;
  disabledAt: Date | null;
  allowedModels: AllowedModel[];
  allowedModelGroups: AllowedModelGroup[];
  directUpstreamAccess: boolean;
  lastRotatedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface IntegrationDetail extends IntegrationSummary {
  activeKeyCount: number;
  revokedKeyCount: number;
  customerCount: number;
}

export type IntegrationRotation = ApiKeyRotation;

export interface IntegrationCustomer {
  customerId: string;
  activeKeyCount: number;
  revokedKeyCount: number;
  spent: number;
  requestCount: number;
  cost: number;
  lastRequestAt: Date | null;
}

export interface IntegrationCustomerPage {
  items: IntegrationCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatedIntegration extends IntegrationSummary {
  secret: string;
}

export interface IntegrationPrincipal extends ModelAllowance {
  integrationId: string;
  integrationName: string;
  hasDirectUpstreamAccess: boolean;
}
