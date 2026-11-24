import { ConflictException, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import {
  type ProviderAccount,
  providerAccountColumns,
  storedKey,
} from "@/upstream/models/provider-account.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { UpdateProviderAccountCommand } from "@/upstream/commands/impl/update-provider-account.command.js";

@CommandHandler(UpdateProviderAccountCommand)
export class UpdateProviderAccountHandler implements ICommandHandler<UpdateProviderAccountCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    providerAccountId,
    changes,
  }: UpdateProviderAccountCommand): Promise<ProviderAccount> {
    const { key, ...fields } = changes;
    const values: Partial<typeof providerAccounts.$inferInsert> = { ...fields };
    if (key !== undefined) {
      await this.requireApiKeyAccount(providerAccountId);
      Object.assign(values, storedKey(this.keyCipher, key));
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
    await this.snapshot.changed();
    return updated;
  }

  private async requireApiKeyAccount(providerAccountId: string): Promise<void> {
    const [account] = await this.db
      .select({ credentialKind: providerAccounts.credentialKind })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    if (account?.credentialKind === "oauth-login") {
      throw new ConflictException(
        "Provider Account holds an OAuth Login, which a key can't replace",
      );
    }
  }
}
