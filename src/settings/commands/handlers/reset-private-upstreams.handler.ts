import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ReloadSnapshotCommand } from '@/snapshot/commands/impl/reload-snapshot.command';
import { toPrivateUpstreamsSetting } from '@/settings/models/private-upstreams-view';
import type { PrivateUpstreamsSetting } from '@/settings/models/private-upstreams';
import { SETTING_DEFINITIONS } from '@/settings/models/setting-definitions';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ResetPrivateUpstreamsCommand } from '@/settings/commands/impl/reset-private-upstreams.command';

@CommandHandler(ResetPrivateUpstreamsCommand)
export class ResetPrivateUpstreamsHandler implements ICommandHandler<ResetPrivateUpstreamsCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly commandBus: CommandBus,
  ) {}

  async execute(): Promise<PrivateUpstreamsSetting> {
    await this.store.reset('allowPrivateUpstreams');
    await this.commandBus.execute(new ReloadSnapshotCommand());
    return toPrivateUpstreamsSetting({
      value: SETTING_DEFINITIONS.allowPrivateUpstreams.default,
      isDefault: true,
    });
  }
}
