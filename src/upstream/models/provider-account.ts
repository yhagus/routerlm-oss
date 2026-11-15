import { providerAccounts } from "@/db/schemas/index.js";
import type { ProviderKeyCipher } from "../providers/provider-key-cipher.js";

const KEY_HINT_LENGTH = 4;

/** Every column except the encrypted key: what the dashboard API may return. */
export const providerAccountColumns = {
  id: providerAccounts.id,
  providerId: providerAccounts.providerId,
  name: providerAccounts.name,
  keyLastFour: providerAccounts.keyLastFour,
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

/** A Provider Account as the dashboard API returns it: never the key, only its last four characters. */
export type ProviderAccount = Omit<typeof providerAccounts.$inferSelect, "encryptedKey">;

type StoredKey = Pick<ProviderAccount, "keyLastFour"> & { encryptedKey: string };

/** The columns that store a Provider Account key: encrypted, plus its last four characters. */
export function storedKey(keyCipher: ProviderKeyCipher, key: string): StoredKey {
  return { encryptedKey: keyCipher.encrypt(key), keyLastFour: key.slice(-KEY_HINT_LENGTH) };
}
