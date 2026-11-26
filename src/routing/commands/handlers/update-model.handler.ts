import { NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { Model } from '@/routing/models/model';
import { findModelGroups, replaceModelGroups } from '@/routing/models/model-group-memberships';
import { toModelWriteError } from '@/routing/models/write-errors';
import { UpdateModelCommand } from '@/routing/commands/impl/update-model.command';

@CommandHandler(UpdateModelCommand)
export class UpdateModelHandler implements ICommandHandler<UpdateModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, changes }: UpdateModelCommand): Promise<Model> {
    const { groupIds, ...fields } = changes;
    let updated: typeof models.$inferSelect | undefined;
    try {
      updated = await this.db.transaction(async (transaction) => {
        const [model] = await transaction
          .update(models)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(models.id, modelId))
          .returning();
        if (model && groupIds) {
          await replaceModelGroups(transaction, model.id, groupIds);
        }
        return model;
      });
    } catch (error) {
      throw toModelWriteError(error, changes.name);
    }
    if (!updated) {
      throw new NotFoundException('Model not found');
    }
    await this.snapshot.changed();
    return { ...updated, groups: await findModelGroups(this.db, modelId) };
  }
}
