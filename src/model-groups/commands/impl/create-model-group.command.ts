import { Command } from '@nestjs/cqrs';
import type { ModelGroup } from '@/model-groups/models/model-group';
import type { NewModelGroup } from '@/model-groups/schemas/model-group.schema';

export class CreateModelGroupCommand extends Command<ModelGroup> {
  constructor(readonly newModelGroup: NewModelGroup) {
    super();
  }
}
