import type { IncomingHttpHeaders } from "node:http";
import type { CatalogProviderQuirks } from "@/catalog/schemas/catalog.schema";

export function forwardedClientHeadersOf(
  quirks: CatalogProviderQuirks,
  clientHeaders: IncomingHttpHeaders,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const name of quirks.forwardedClientHeaders ?? []) {
    const value = clientHeaders[name];
    if (typeof value === "string" && value !== "") {
      forwarded[name] = value;
    }
  }
  return forwarded;
}
