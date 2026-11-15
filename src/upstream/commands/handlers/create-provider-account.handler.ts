import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import { FOREIGN_KEY_VIOLATION, hasPostgresErrorCode } from "@/libs/models/postgres-errors.js";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { unusedConstellationName } from "../../models/constellation-name.js";
import {
  type ProviderAccount,
  providerAccountColumns,
  storedKey,
} from "../../models/provider-account.js";
import { ProviderKeyCipher } from "../../providers/provider-key-cipher.js";
import { CreateProviderAccountCommand } from "../impl/create-provider-account.command.js";

@CommandHandler(CreateProviderAccountCommand)
export class CreateProviderAccountHandler implements ICommandHandler<CreateProviderAccountCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newAccount }: CreateProviderAccountCommand): Promise<ProviderAccount> {
    const { key, name, ...fields } = newAccount;
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

  /** A constellation name no other account of the Provider uses, so the dashboard can tell them apart. */
  private async generateName(providerId: string): Promise<string> {
    const siblings = await this.db
      .select({ name: providerAccounts.name })
      .from(providerAccounts)
      .where(eq(providerAccounts.providerId, providerId));
    return unusedConstellationName(new Set(siblings.map((sibling) => sibling.name)));
  }
}
