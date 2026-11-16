import { providerAccounts } from "@/db/schemas/index.js";
import { SECOND_MS } from "@/libs/models/duration.js";
import type { CodexAccount } from "./openai-codex-tokens.js";
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
  oauthEmail: providerAccounts.oauthEmail,
  oauthPlanType: providerAccounts.oauthPlanType,
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
 * an API key, `oauthEmail` and `oauthPlanType` for all but an OpenAI Codex login.
 */
export type ProviderAccount = Omit<
  typeof providerAccounts.$inferSelect,
  | "encryptedKey"
  | "oauthEncryptedAccessToken"
  | "oauthEncryptedRefreshToken"
  | "oauthGrantedAt"
  | "oauthExpiresAt"
  | "oauthDeviceId"
  | "oauthEncryptedIdToken"
  | "oauthAccountId"
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
  /**
   * OpenAI Codex only: the id_token granted with them and what it says.
   * Absent from a refresh that returned no id_token, which keeps the stored one.
   */
  codexAccount?: CodexAccount;
}

type StoredOauthTokens = {
  oauthEncryptedAccessToken: string;
  oauthEncryptedRefreshToken: string;
  oauthGrantedAt: Date;
  oauthExpiresAt: Date;
  oauthEncryptedIdToken?: string;
  oauthAccountId?: string;
  oauthEmail?: string;
  oauthPlanType?: string;
};

/**
 * The columns that store an OAuth Login's tokens, granted at `grantedAt`:
 * every token encrypted, and whatever of the Codex account the id_token names.
 */
export function storedOauthTokens(
  keyCipher: ProviderKeyCipher,
  tokens: OauthTokens,
  grantedAt: Date,
): StoredOauthTokens {
  const stored: StoredOauthTokens = {
    oauthEncryptedAccessToken: keyCipher.encrypt(tokens.accessToken),
    oauthEncryptedRefreshToken: keyCipher.encrypt(tokens.refreshToken),
    oauthGrantedAt: grantedAt,
    oauthExpiresAt: new Date(grantedAt.getTime() + tokens.expiresInSeconds * SECOND_MS),
  };
  const { codexAccount } = tokens;
  if (codexAccount === undefined) {
    return stored;
  }
  // A refreshed id_token may leave out a claim: the stored value stays, so the
  // account id sent as `chatgpt-account-id` is never lost.
  return {
    ...stored,
    oauthEncryptedIdToken: keyCipher.encrypt(codexAccount.idToken),
    ...(codexAccount.accountId === null ? {} : { oauthAccountId: codexAccount.accountId }),
    ...(codexAccount.email === null ? {} : { oauthEmail: codexAccount.email }),
    ...(codexAccount.planType === null ? {} : { oauthPlanType: codexAccount.planType }),
  };
}
