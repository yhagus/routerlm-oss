import { ConflictException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { SpendLimitFlags } from "@/spend-limits/providers/spend-limit-flags.js";
import type { ApiKeySummary } from "../../models/api-key.js";
import { selectApiKeySummaries } from "../../models/api-key-summaries.js";
import { assertModelsExist } from "../../models/assert-models-exist.js";
import { assertUserOwnsKey, findUnrevokedApiKey } from "../../models/find-unrevoked-api-key.js";
import { UpdateApiKeyCommand } from "../impl/update-api-key.command.js";

const REVOKED_MESSAGE = "A revoked API Key can't be changed.";

@CommandHandler(UpdateApiKeyCommand)
export class UpdateApiKeyHandler implements ICommandHandler<UpdateApiKeyCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
    private readonly spendLimitFlags: SpendLimitFlags,
  ) {}

  async execute({ id, changes }: UpdateApiKeyCommand): Promise<ApiKeySummary> {
    assertUserOwnsKey(await findUnrevokedApiKey(this.db, id, REVOKED_MESSAGE));
    if (changes.allowedModelIds) {
      await assertModelsExist(this.db, changes.allowedModelIds);
    }
    // Guarded again on revokedAt: the key may have been revoked since the check.
    const updated = await this.db
      .update(apiKeys)
      .set(changes)
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (updated.length === 0) {
      throw new ConflictException(REVOKED_MESSAGE);
    }
    if (changes.spendLimit !== undefined) {
      // So a raised or cleared limit serves the key at once, and a lowered one stops it.
      await this.spendLimitFlags.recompute(id);
    }
    // Name, allowed Models and Spend Limit are part of what sign-in reads from the snapshot.
    await this.snapshot.changed();
    const [summary] = await selectApiKeySummaries(this.db, eq(apiKeys.id, id));
    return summary;
  }
}
