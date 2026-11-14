import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDrizzle } from "@nestjs/drizzle";
import { asc, eq } from "drizzle-orm";
import { FOREIGN_KEY_VIOLATION, hasPostgresErrorCode } from "../db/postgres-errors.js";
import type { Database } from "../db/relations.js";
import { providerAccounts } from "../db/schema.js";
import { ProviderKeyCipher } from "./provider-key-cipher.js";
import { UpstreamChangeSignal } from "./upstream-change-signal.js";
import type { NewProviderAccount, ProviderAccountChanges } from "./upstream.schemas.js";

const KEY_HINT_LENGTH = 4;

/** Every column except the encrypted key: what the dashboard API may return. */
const providerAccountColumns = {
  id: providerAccounts.id,
  providerId: providerAccounts.providerId,
  name: providerAccounts.name,
  keyLastFour: providerAccounts.keyLastFour,
  priority: providerAccounts.priority,
  isEnabled: providerAccounts.isEnabled,
  disabledReason: providerAccounts.disabledReason,
  lastError: providerAccounts.lastError,
  lastErrorAt: providerAccounts.lastErrorAt,
  createdAt: providerAccounts.createdAt,
  updatedAt: providerAccounts.updatedAt,
};

/** A Provider Account as the dashboard API returns it: never the key, only its last four characters. */
export type ProviderAccount = Omit<typeof providerAccounts.$inferSelect, "encryptedKey">;

type StoredKey = Pick<ProviderAccount, "keyLastFour"> & { encryptedKey: string };

@Injectable()
export class ProviderAccountsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly changeSignal: UpstreamChangeSignal,
  ) {}

  listProviderAccounts(): Promise<ProviderAccount[]> {
    return this.db
      .select(providerAccountColumns)
      .from(providerAccounts)
      .orderBy(asc(providerAccounts.providerId), asc(providerAccounts.priority));
  }

  async createProviderAccount(newAccount: NewProviderAccount): Promise<ProviderAccount> {
    const { key, ...fields } = newAccount;
    try {
      const [created] = await this.db
        .insert(providerAccounts)
        .values({ ...fields, ...this.storedKey(key) })
        .returning(providerAccountColumns);
      await this.changeSignal.changed();
      return created;
    } catch (error) {
      if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
        throw new NotFoundException("Provider not found");
      }
      throw error;
    }
  }

  /**
   * Edits a Provider Account. A new `key` replaces the stored one. Enabling it
   * clears the reason the gateway gave for disabling it.
   */
  async updateProviderAccount(
    providerAccountId: string,
    changes: ProviderAccountChanges,
  ): Promise<ProviderAccount> {
    const { key, ...fields } = changes;
    const values: Partial<typeof providerAccounts.$inferInsert> = { ...fields };
    if (key !== undefined) {
      Object.assign(values, this.storedKey(key));
    }
    if (changes.isEnabled === true) {
      values.disabledReason = null;
    }
    const [updated] = await this.db
      .update(providerAccounts)
      .set(values)
      .where(eq(providerAccounts.id, providerAccountId))
      .returning(providerAccountColumns);
    if (!updated) {
      throw new NotFoundException("Provider Account not found");
    }
    await this.changeSignal.changed();
    return updated;
  }

  async deleteProviderAccount(providerAccountId: string): Promise<void> {
    const deleted = await this.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId))
      .returning({ id: providerAccounts.id });
    if (deleted.length === 0) {
      throw new NotFoundException("Provider Account not found");
    }
    await this.changeSignal.changed();
  }

  private storedKey(key: string): StoredKey {
    return { encryptedKey: this.keyCipher.encrypt(key), keyLastFour: key.slice(-KEY_HINT_LENGTH) };
  }
}
