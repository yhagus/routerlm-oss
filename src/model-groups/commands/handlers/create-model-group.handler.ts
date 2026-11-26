import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Database } from '@/db/schemas/relations';
import { modelGroups } from '@/db/schemas';
import type { ModelGroup } from '@/model-groups/models/model-group';
import { toModelGroupWriteError } from '@/model-groups/models/write-errors';
import { CreateModelGroupCommand } from '@/model-groups/commands/impl/create-model-group.command';

@CommandHandler(CreateModelGroupCommand)
export class CreateModelGroupHandler implements ICommandHandler<CreateModelGroupCommand> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ newModelGroup }: CreateModelGroupCommand): Promise<ModelGroup> {
    try {
      const [created] = await this.db.insert(modelGroups).values(newModelGroup).returning();
      return created;
    } catch (error) {
      throw toModelGroupWriteError(error, newModelGroup.slug);
    }
  }
}
