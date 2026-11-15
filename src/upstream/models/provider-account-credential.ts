/** What a call to a Provider sends for one Provider Account. */
export interface ProviderAccountCredential {
  /** The API key, or the OAuth Login's access token. */
  secret: string;
  /**
   * What an inference call sends besides the secret: the CLI identity of an
   * OAuth Login (ADR 0012), nothing for an API key.
   */
  identityHeaders: Record<string, string>;
}

export function apiKeyCredential(key: string): ProviderAccountCredential {
  return { secret: key, identityHeaders: {} };
}

/**
 * The Provider Account has no usable credential right now, for a reason that
 * says nothing against the account: its auth host or the refresh lock did
 * not answer.
 */
export class CredentialUnavailableError extends Error {}

/**
 * The Provider no longer accepts the account's OAuth Login. The account has
 * been disabled; only a new sign-in restores it.
 */
export class OauthLoginRefusedError extends Error {}
