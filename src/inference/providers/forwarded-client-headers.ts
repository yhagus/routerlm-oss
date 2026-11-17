import type { IncomingHttpHeaders } from "node:http";
import type { CatalogProviderQuirks } from "@/catalog/schemas/catalog.schema.js";

/**
 * The client's request headers that the Provider's `forwardedClientHeaders`
 * quirk names and the client actually sent, with a value: nothing else leaves
 * the gateway, and an empty header never replaces the gateway's own user agent.
 */
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
