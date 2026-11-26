import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { Model } from '@/routing/models/model';
import { toModelWriteError } from '@/routing/models/write-errors';
import { CreateModelCommand } from '@/routing/commands/impl/create-model.command';

@CommandHandler(CreateModelCommand)
export class CreateModelHandler implements ICommandHandler<CreateModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newModel }: CreateModelCommand): Promise<Model> {
    try {
      const [created] = await this.db.insert(models).values(newModel).returning();
      await this.snapshot.changed();
      return created;
    } catch (error) {
      throw toModelWriteError(error, newModel.name);
    }
  }
}
