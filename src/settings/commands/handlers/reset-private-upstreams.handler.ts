import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { toPrivateUpstreamsSetting } from '@/settings/models/private-upstreams-view';
import type { PrivateUpstreamsSetting } from '@/settings/models/private-upstreams';
import { SETTING_DEFINITIONS } from '@/settings/models/setting-definitions';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ResetPrivateUpstreamsCommand } from '@/settings/commands/impl/reset-private-upstreams.command';

@CommandHandler(ResetPrivateUpstreamsCommand)
export class ResetPrivateUpstreamsHandler implements ICommandHandler<ResetPrivateUpstreamsCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute(): Promise<PrivateUpstreamsSetting> {
    await this.store.reset('allowPrivateUpstreams');
    await this.snapshot.changed();
    return toPrivateUpstreamsSetting({
      value: SETTING_DEFINITIONS.allowPrivateUpstreams.default,
      isDefault: true,
    });
  }
}
