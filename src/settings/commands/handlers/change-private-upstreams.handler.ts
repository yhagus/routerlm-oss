import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { toPrivateUpstreamsSetting } from '@/settings/models/private-upstreams-view';
import type { PrivateUpstreamsSetting } from '@/settings/models/private-upstreams';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ChangePrivateUpstreamsCommand } from '@/settings/commands/impl/change-private-upstreams.command';

@CommandHandler(ChangePrivateUpstreamsCommand)
export class ChangePrivateUpstreamsHandler implements ICommandHandler<ChangePrivateUpstreamsCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ allowed }: ChangePrivateUpstreamsCommand): Promise<PrivateUpstreamsSetting> {
    await this.store.write('allowPrivateUpstreams', allowed);
    await this.snapshot.changed();
    return toPrivateUpstreamsSetting({ value: allowed, isDefault: false });
  }
}
