import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { sql } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { routes } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { ModelDetail } from '@/routing/models/model';
import { findModelDetail } from '@/routing/models/model-detail';
import { assertRouteKindFits } from '@/routing/models/route-kind';
import { toRouteWriteError } from '@/routing/models/write-errors';
import { AddRouteCommand } from '@/routing/commands/impl/add-route.command';

@CommandHandler(AddRouteCommand)
export class AddRouteHandler implements ICommandHandler<AddRouteCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ modelId, newRoute }: AddRouteCommand): Promise<ModelDetail> {
    const model = await findModelDetail(this.db, modelId);
    await assertRouteKindFits(this.db, model, newRoute.upstreamModelId);
    const lastPriorityPlusOne = sql<number>`(
      select coalesce(max(${routes.priority}) + 1, 0) from ${routes} where ${routes.modelId} = ${modelId}
    )`;
    try {
      await this.db.insert(routes).values({ ...newRoute, modelId, priority: lastPriorityPlusOne });
    } catch (error) {
      throw toRouteWriteError(error);
    }
    await this.snapshot.changed();
    return findModelDetail(this.db, modelId);
  }
}
