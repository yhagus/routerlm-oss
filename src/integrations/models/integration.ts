import type { AllowedModel, ApiKeyRotation } from "@/api-keys/models/api-key.js";

/** An Integration as the dashboard lists it: never its secret nor the secret's hash. */
export interface IntegrationSummary {
  id: string;
  name: string;
  /** The public id inside the Integration Secret (`rlmi_<keyId>_<secret>`). */
  keyId: string;
  /** Null when the User who created it was deleted. */
  createdBy: { id: string; email: string } | null;
  createdAt: Date;
  /** Null while the Integration is active. */
  disabledAt: Date | null;
  /** Empty means every Model. */
  allowedModels: AllowedModel[];
  /** Null when its secret was never rotated. */
  lastRotatedAt: Date | null;
  /** When its secret last signed a control plane call in, to the minute. Null if never. */
  lastUsedAt: Date | null;
}

/** One Integration on its dashboard page: its summary and how many API Keys and Customers it has. */
export interface IntegrationDetail extends IntegrationSummary {
  /** API Keys it issued that are not revoked, expired ones included. */
  activeKeyCount: number;
  revokedKeyCount: number;
  /** Distinct Customers named on its API Keys, revoked ones included. */
  customerCount: number;
}

/** One rotation of an Integration Secret, shaped like an API Key's. */
export type IntegrationRotation = ApiKeyRotation;

/** One Customer of an Integration, rolled up over all time from its API Keys and their Usage Logs. */
export interface IntegrationCustomer {
  customerId: string;
  activeKeyCount: number;
  revokedKeyCount: number;
  /** USD its API Keys have spent against their Spend Limits. */
  spent: number;
  requestCount: number;
  /** USD of Cost over its Usage Logs; logs of unknown Cost count as 0. */
  cost: number;
  /** Null when its API Keys never made a request. */
  lastRequestAt: Date | null;
}

/** One page of an Integration's Customers, most recently active first, as /usage pages its logs. */
export interface IntegrationCustomerPage {
  items: IntegrationCustomer[];
  /** How many Customers match the search, over all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/** A just-created Integration, or one whose secret was just rotated, with the whole Integration Secret. */
export interface CreatedIntegration extends IntegrationSummary {
  secret: string;
}

/** Who a call signed in with an Integration Secret acts as. */
export interface IntegrationPrincipal {
  integrationId: string;
  integrationName: string;
  /** The Models its API Keys may use. Empty means every Model. */
  allowedModelIds: string[];
}
