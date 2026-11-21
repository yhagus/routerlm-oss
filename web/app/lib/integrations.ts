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
