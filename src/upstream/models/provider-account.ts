import { providerAccounts } from '@/db/schemas';
import { SECOND_MS } from '@/libs/models/duration';
import type { CodexAccount } from './openai-codex-tokens';
import type { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';

const KEY_HINT_LENGTH = 4;

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

export type ProviderAccount = Omit<
  typeof providerAccounts.$inferSelect,
  | 'encryptedKey'
  | 'oauthEncryptedAccessToken'
  | 'oauthEncryptedRefreshToken'
  | 'oauthGrantedAt'
  | 'oauthExpiresAt'
  | 'oauthDeviceId'
  | 'oauthEncryptedIdToken'
  | 'oauthAccountId'
>;

type StoredKey = { encryptedKey: string; keyLastFour: string };

export function storedKey(keyCipher: ProviderKeyCipher, key: string): StoredKey {
  return { encryptedKey: keyCipher.encrypt(key), keyLastFour: key.slice(-KEY_HINT_LENGTH) };
}

export interface OauthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
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
  return {
    ...stored,
    oauthEncryptedIdToken: keyCipher.encrypt(codexAccount.idToken),
    ...(codexAccount.accountId === null ? {} : { oauthAccountId: codexAccount.accountId }),
    ...(codexAccount.email === null ? {} : { oauthEmail: codexAccount.email }),
    ...(codexAccount.planType === null ? {} : { oauthPlanType: codexAccount.planType }),
  };
}
