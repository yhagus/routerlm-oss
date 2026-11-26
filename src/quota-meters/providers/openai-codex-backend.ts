import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential";

export function codexBackendRequestOf(
  { secret, identityHeaders }: ProviderAccountCredential,
  baseUrl: string,
  path: string,
): { url: string; headers: Record<string, string> } {
  return {
    url: `${new URL(baseUrl).origin}${path}`,
    headers: { ...identityHeaders, authorization: `Bearer ${secret}`, accept: "application/json" },
  };
}
