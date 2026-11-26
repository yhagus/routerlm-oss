import { Command } from '@nestjs/cqrs';
import type { Model } from '@/routing/models/model';
import type { NewModel } from '@/routing/schemas/routing.schema';

export class CreateModelCommand extends Command<Model> {
  constructor(readonly newModel: NewModel) {
    super();
  }
}
