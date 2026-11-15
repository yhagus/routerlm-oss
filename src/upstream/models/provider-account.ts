import { providerAccounts } from "@/db/schemas/index.js";
import type { ProviderKeyCipher } from "../providers/provider-key-cipher.js";

const KEY_HINT_LENGTH = 4;

/** Every column except the encrypted key and the OAuth Login's tokens: what the dashboard API may return. */
export const providerAccountColumns = {
  id: providerAccounts.id,
  providerId: providerAccounts.providerId,
  name: providerAccounts.name,
  credentialKind: providerAccounts.credentialKind,
  keyLastFour: providerAccounts.keyLastFour,
  oauthRegion: providerAccounts.oauthRegion,
  priority: providerAccounts.priority,
  isEnabled: providerAccounts.isEnabled,
  disabledReason: providerAccounts.disabledReason,
  lastError: providerAccounts.lastError,
  lastErrorAt: providerAccounts.lastErrorAt,
  continueWhenExhausted: providerAccounts.continueWhenExhausted,
  quotaCheckedAt: providerAccounts.quotaCheckedAt,
  quotaError: providerAccounts.quotaError,
  createdAt: providerAccounts.createdAt,
  updatedAt: providerAccounts.updatedAt,
};

/**
 * A Provider Account as the dashboard API returns it: which credential it
 * holds, but never the key (only its last four characters) nor an OAuth
 * Login's tokens. `keyLastFour` is null for an OAuth Login, `oauthRegion` for
 * an API key.
 */
export type ProviderAccount = Omit<
  typeof providerAccounts.$inferSelect,
  | "encryptedKey"
  | "oauthEncryptedAccessToken"
  | "oauthEncryptedRefreshToken"
  | "oauthGrantedAt"
  | "oauthExpiresAt"
  | "oauthDeviceId"
>;

type StoredKey = { encryptedKey: string; keyLastFour: string };

/** The columns that store a Provider Account key: encrypted, plus its last four characters. */
export function storedKey(keyCipher: ProviderKeyCipher, key: string): StoredKey {
  return { encryptedKey: keyCipher.encrypt(key), keyLastFour: key.slice(-KEY_HINT_LENGTH) };
}

/** The tokens a Provider's auth host grants, and how long the access token lasts. */
export interface OauthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

type StoredOauthTokens = {
  oauthEncryptedAccessToken: string;
  oauthEncryptedRefreshToken: string;
  oauthGrantedAt: Date;
  oauthExpiresAt: Date;
};

const SECOND_MS = 1000;

/** The columns that store an OAuth Login's tokens, granted at `grantedAt`: both encrypted. */
export function storedOauthTokens(
  keyCipher: ProviderKeyCipher,
  tokens: OauthTokens,
  grantedAt: Date,
): StoredOauthTokens {
  return {
    oauthEncryptedAccessToken: keyCipher.encrypt(tokens.accessToken),
    oauthEncryptedRefreshToken: keyCipher.encrypt(tokens.refreshToken),
    oauthGrantedAt: grantedAt,
    oauthExpiresAt: new Date(grantedAt.getTime() + tokens.expiresInSeconds * SECOND_MS),
  };
}
