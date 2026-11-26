import { ConflictException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { apiKeys } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { SpendLimitFlags } from '@/spend-limits/providers/spend-limit-flags';
import type { ApiKeySummary } from '@/api-keys/models/api-key';
import { selectApiKeySummaries } from '@/api-keys/models/api-key-summaries';
import { assertModelGroupsExist, assertModelsExist } from '@/libs/models/allowed-models';
import { assertUserOwnsKey, findUnrevokedApiKey } from '@/api-keys/models/find-unrevoked-api-key';
import { UpdateApiKeyCommand } from '@/api-keys/commands/impl/update-api-key.command';

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
    if (changes.allowedModelGroupIds) {
      await assertModelGroupsExist(this.db, changes.allowedModelGroupIds);
    }
    const updated = await this.db
      .update(apiKeys)
      .set(changes)
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (updated.length === 0) {
      throw new ConflictException(REVOKED_MESSAGE);
    }
    if (changes.spendLimit !== undefined) {
      await this.spendLimitFlags.recompute(id);
    }
    await this.snapshot.changed();
    const [summary] = await selectApiKeySummaries(this.db, eq(apiKeys.id, id));
    return summary;
  }
}
