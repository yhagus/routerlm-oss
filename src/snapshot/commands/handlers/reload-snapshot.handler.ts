import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { ReloadSnapshotCommand } from '@/snapshot/commands/impl/reload-snapshot.command';

@CommandHandler(ReloadSnapshotCommand)
export class ReloadSnapshotHandler implements ICommandHandler<ReloadSnapshotCommand> {
  constructor(private readonly snapshot: SnapshotService) {}

  async execute(): Promise<void> {
    await this.snapshot.changed();
  }
}
