/** An Integration as the dashboard API lists it: never its Integration Secret. */
export interface IntegrationSummary {
  id: string;
  name: string;
  /** The public id inside the Integration Secret, `rlmi_<keyId>_<secret>`. */
  keyId: string;
  /** Null when the User who created it was deleted. */
  createdBy: { id: string; email: string } | null;
  createdAt: string;
  /** Null while the Integration is enabled. */
  disabledAt: string | null;
  /** Empty means every Model. A `null` name is a Model that was deleted. */
  allowedModels: { id: string; name: string | null }[];
  /** Null when its Integration Secret was never rotated. */
  lastRotatedAt: string | null;
}

/** The create and rotate responses: the whole Integration Secret, shown this once. */
export interface CreatedIntegration extends IntegrationSummary {
  secret: string;
}

export type IntegrationStatus = "enabled" | "disabled";

export function integrationStatus(integration: IntegrationSummary): IntegrationStatus {
  return integration.disabledAt ? "disabled" : "enabled";
}

/**
 * The Integration that issued a request's API Key and the Customer it names, as
 * a Usage Log or Error Capture copied them at request time, so they outlive the
 * Integration. All null for a key no Integration issued.
 */
export interface RecordedIntegration {
  integrationId: string | null;
  integrationName: string | null;
  customerId: string | null;
}
