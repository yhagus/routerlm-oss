import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential.js";

/**
 * The URL and headers of a call to the ChatGPT backend at `path`, on the
 * origin of the Provider's base URL (`https://chatgpt.com/backend-api/codex`),
 * sent as the Codex CLI sends it: with the OAuth Login's access token, ChatGPT
 * account id and CLI identity headers (ADR 0013).
 */
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
