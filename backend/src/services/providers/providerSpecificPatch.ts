import type { ProviderConnection } from "../../db/repositories";

// The data part of a Connection patch for provider-specific fields. v1-shaped
// rows keep these fields in a nested providerSpecificData object, and
// providers.patch merges that object one level deep. v2 rows keep them flat.
export function providerSpecificPatch(connection: ProviderConnection | null | undefined, fields: Record<string, unknown>): Record<string, unknown> {
  const nested = connection?.data.providerSpecificData;
  return nested != null && typeof nested === "object" && !Array.isArray(nested) ? { providerSpecificData: fields } : fields;
}
