import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { Model } from '@/routing/models/model';
import { findModelGroups, replaceModelGroups } from '@/routing/models/model-group-memberships';
import { toModelWriteError } from '@/routing/models/write-errors';
import { CreateModelCommand } from '@/routing/commands/impl/create-model.command';

@CommandHandler(CreateModelCommand)
export class CreateModelHandler implements ICommandHandler<CreateModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newModel }: CreateModelCommand): Promise<Model> {
    const { groupIds, ...fields } = newModel;
    let created: typeof models.$inferSelect;
    try {
      created = await this.db.transaction(async (transaction) => {
        const [model] = await transaction.insert(models).values(fields).returning();
        await replaceModelGroups(transaction, model.id, groupIds);
        return model;
      });
    } catch (error) {
      throw toModelWriteError(error, newModel.name);
    }
    await this.snapshot.changed();
    return { ...created, groups: await findModelGroups(this.db, created.id) };
  }
}
