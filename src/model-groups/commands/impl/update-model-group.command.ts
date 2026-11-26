import { Command } from '@nestjs/cqrs';
import type { ModelGroup } from '@/model-groups/models/model-group';
import type { ModelGroupChanges } from '@/model-groups/schemas/model-group.schema';

export class UpdateModelGroupCommand extends Command<ModelGroup> {
  constructor(
    readonly modelGroupId: string,
    readonly changes: ModelGroupChanges,
  ) {
    super();
  }
}
