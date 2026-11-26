import { NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { modelGroups } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { ModelGroup } from '@/model-groups/models/model-group';
import { toModelGroupWriteError } from '@/model-groups/models/write-errors';
import { UpdateModelGroupCommand } from '@/model-groups/commands/impl/update-model-group.command';

@CommandHandler(UpdateModelGroupCommand)
export class UpdateModelGroupHandler implements ICommandHandler<UpdateModelGroupCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelGroupId, changes }: UpdateModelGroupCommand): Promise<ModelGroup> {
    let updated: ModelGroup | undefined;
    try {
      [updated] = await this.db
        .update(modelGroups)
        .set(changes)
        .where(eq(modelGroups.id, modelGroupId))
        .returning();
    } catch (error) {
      throw toModelGroupWriteError(error, changes.slug);
    }
    if (!updated) {
      throw new NotFoundException('Model Group not found');
    }
    await this.snapshot.changed();
    return updated;
  }
}
