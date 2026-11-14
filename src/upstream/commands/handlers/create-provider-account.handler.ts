import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { FOREIGN_KEY_VIOLATION, hasPostgresErrorCode } from "../../../db/models/postgres-errors.js";
import type { Database } from "../../../db/schemas/relations.js";
import { providerAccounts } from "../../../db/schemas/index.js";
import { SnapshotService } from "../../../snapshot/providers/snapshot.service.js";
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
    const { key, ...fields } = newAccount;
    try {
      const [created] = await this.db
        .insert(providerAccounts)
        .values({ ...fields, ...storedKey(this.keyCipher, key) })
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
}
