import { NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { DeleteModelCommand } from '@/routing/commands/impl/delete-model.command';

@CommandHandler(DeleteModelCommand)
export class DeleteModelHandler implements ICommandHandler<DeleteModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId }: DeleteModelCommand): Promise<void> {
    const deleted = await this.db
      .delete(models)
      .where(eq(models.id, modelId))
      .returning({ id: models.id });
    if (deleted.length === 0) {
      throw new NotFoundException('Model not found');
    }
    await this.snapshot.changed();
  }
}
