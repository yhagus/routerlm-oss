import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { RevokeApiKeyCommand } from "../impl/revoke-api-key.command.js";

@CommandHandler(RevokeApiKeyCommand)
export class RevokeApiKeyHandler implements ICommandHandler<RevokeApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ id }: RevokeApiKeyCommand): Promise<void> {
    const revoked = await this.db
      .update(apiKeys)
      // A revoked key never needs showing again, so its encrypted copy goes.
      .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())`, encryptedKey: null })
      .where(eq(apiKeys.id, id))
      .returning({ id: apiKeys.id });
    if (revoked.length === 0) {
      throw new NotFoundException("API Key not found");
    }
    await this.snapshot.changed();
  }
}
