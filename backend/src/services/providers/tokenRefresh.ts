import type { ProviderConnection } from "../../db/repositories";
import { getProviderMetadata } from "./providerCatalog";

export interface RefreshedCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  idToken?: string;
}

function credentials(connection: ProviderConnection): Record<string, unknown> {
  return { ...connection.data, ...connection.credentials };
}

export async function refreshProviderToken(connection: ProviderConnection): Promise<RefreshedCredentials | null> {
  const auth = credentials(connection);
  const refreshToken = typeof auth.refreshToken === "string" ? auth.refreshToken : "";
  if (!refreshToken) return null;
  const metadata: any = getProviderMetadata(connection.provider);
  const refreshUrl = metadata?.refreshUrl;
  if (!refreshUrl) return null;

  // Reuse v1's provider-specific refresh adapters where the OAuth provider has
  // non-standard headers, token formats, or rotated credential behavior.
  try {
    const adapters = await import("./oauth/tokenRefresh/providers.ts");
    let result: any = null;
    if (connection.provider === "grok-cli") result = await adapters.refreshGrokCliToken(refreshToken);
    else if (connection.provider === "codex") result = await adapters.refreshCodexToken(refreshToken);
    else if (connection.provider === "claude" || connection.provider === "anthropic") result = await adapters.refreshClaudeOAuthToken(refreshToken);
    else if (connection.provider === "codebuddy") result = await adapters.refreshCodebuddyToken(refreshToken);
    if (result?.accessToken) return result as RefreshedCredentials;
  } catch {
    // Fall through to the standard OAuth2 refresh request below.
  }

  const payload = { grant_type: "refresh_token", refresh_token: refreshToken, ...(metadata?.clientId ? { client_id: metadata.clientId } : {}) };
  const jsonBody = connection.provider === "claude" || connection.provider === "codex";
  try {
    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": jsonBody ? "application/json" : "application/x-www-form-urlencoded" },
      body: jsonBody ? JSON.stringify(payload) : new URLSearchParams(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.access_token !== "string" || !body.access_token) return null;
    return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : refreshToken, expiresIn: Number(body.expires_in) || undefined, idToken: typeof body.id_token === "string" ? body.id_token : undefined };
  } catch {
    return null;
  }
}
