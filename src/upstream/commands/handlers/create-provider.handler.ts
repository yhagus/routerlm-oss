import { ConflictException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { hasPostgresErrorCode, UNIQUE_VIOLATION } from "@/libs/models/postgres-errors.js";
import type { Database } from "@/db/schemas/relations.js";
import { providers } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import {
  assertQuirksFitProtocol,
  assertServiceTierValuesFitProtocol,
  type Provider,
} from "../../models/provider.js";
import { CreateProviderCommand } from "../impl/create-provider.command.js";

@CommandHandler(CreateProviderCommand)
export class CreateProviderHandler implements ICommandHandler<CreateProviderCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newProvider }: CreateProviderCommand): Promise<Provider> {
    assertQuirksFitProtocol(newProvider.protocol, newProvider.quirks);
    assertServiceTierValuesFitProtocol(newProvider.protocol, newProvider.serviceTierValues);
    try {
      const [created] = await this.db.insert(providers).values(newProvider).returning();
      await this.snapshot.changed();
      return created;
    } catch (error) {
      if (hasPostgresErrorCode(error, UNIQUE_VIOLATION)) {
        throw new ConflictException(
          `A Provider with the slug "${newProvider.slug}" already exists`,
        );
      }
      throw error;
    }
  }
}
