import type { AllowedModel } from "@/api-keys/models/api-key.js";

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
