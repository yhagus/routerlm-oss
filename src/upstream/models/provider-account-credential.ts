export interface ProviderAccountCredential {
  secret: string;
  identityHeaders: Record<string, string>;
}

export function apiKeyCredential(key: string): ProviderAccountCredential {
  return { secret: key, identityHeaders: {} };
}

export class CredentialUnavailableError extends Error {}

export class OauthLoginRefusedError extends Error {}
