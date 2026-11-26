import { NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { upstreamModels } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { deleteUnlessRouted } from '@/upstream/models/routed-models';
import { DeleteUpstreamModelCommand } from '@/upstream/commands/impl/delete-upstream-model.command';

@CommandHandler(DeleteUpstreamModelCommand)
export class DeleteUpstreamModelHandler implements ICommandHandler<DeleteUpstreamModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ upstreamModelId }: DeleteUpstreamModelCommand): Promise<void> {
    const [upstreamModel] = await this.db
      .select({ name: upstreamModels.upstreamModelId })
      .from(upstreamModels)
      .where(eq(upstreamModels.id, upstreamModelId));
    if (!upstreamModel) {
      throw new NotFoundException('Upstream Model not found');
    }
    await deleteUnlessRouted(
      this.db,
      `The Upstream Model ${upstreamModel.name}`,
      eq(upstreamModels.id, upstreamModelId),
      async () => {
        await this.db.delete(upstreamModels).where(eq(upstreamModels.id, upstreamModelId));
      },
    );
    await this.snapshot.changed();
  }
}
