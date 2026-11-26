import { ConflictException, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import { FOREIGN_KEY_VIOLATION, hasPostgresErrorCode } from "@/libs/models/postgres-errors";
import type { Database } from "@/db/schemas/relations";
import { providerAccounts, providers } from "@/db/schemas";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import { unusedConstellationName } from "@/upstream/models/constellation-name";
import {
  type ProviderAccount,
  providerAccountColumns,
  storedKey,
} from "@/upstream/models/provider-account";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher";
import { CreateProviderAccountCommand } from "@/upstream/commands/impl/create-provider-account.command";

@CommandHandler(CreateProviderAccountCommand)
export class CreateProviderAccountHandler implements ICommandHandler<CreateProviderAccountCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newAccount }: CreateProviderAccountCommand): Promise<ProviderAccount> {
    const { key, name, ...fields } = newAccount;
    await this.requireApiKeysAccepted(fields.providerId);
    try {
      const [created] = await this.db
        .insert(providerAccounts)
        .values({
          ...fields,
          name: name ?? (await this.generateName(fields.providerId)),
          ...storedKey(this.keyCipher, key),
        })
        .returning(providerAccountColumns);
      await this.snapshot.changed();
      return created;
    } catch (error) {
      if (hasPostgresErrorCode(error, FOREIGN_KEY_VIOLATION)) {
        throw new NotFoundException("Provider not found");
      }
      throw error;
    }
  }

  private async requireApiKeysAccepted(providerId: string): Promise<void> {
    const [provider] = await this.db
      .select({ name: providers.name, credentialKinds: providers.credentialKinds })
      .from(providers)
      .where(eq(providers.id, providerId));
    if (provider && !provider.credentialKinds.includes("api-key")) {
      throw new ConflictException(
        `${provider.name} accepts only OAuth Login; sign in instead of adding an API key`,
      );
    }
  }

  private async generateName(providerId: string): Promise<string> {
    const siblings = await this.db
      .select({ name: providerAccounts.name })
      .from(providerAccounts)
      .where(eq(providerAccounts.providerId, providerId));
    return unusedConstellationName(new Set(siblings.map((sibling) => sibling.name)));
  }
}
