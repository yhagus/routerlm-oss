import { Command } from '@nestjs/cqrs';
import type { ModelDetail } from '@/routing/models/model';
import type { RouteOrder } from '@/routing/schemas/routing.schema';

export class ReorderRoutesCommand extends Command<ModelDetail> {
  constructor(
    readonly modelId: string,
    readonly order: RouteOrder,
  ) {
    super();
  }
}
