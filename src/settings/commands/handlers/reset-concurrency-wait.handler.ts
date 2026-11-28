import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toConcurrencyWaitSetting } from '@/settings/models/concurrency-wait-view';
import type { ConcurrencyWaitSetting } from '@/settings/models/concurrency-wait';
import { SETTING_DEFINITIONS } from '@/settings/models/setting-definitions';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ResetConcurrencyWaitCommand } from '@/settings/commands/impl/reset-concurrency-wait.command';

@CommandHandler(ResetConcurrencyWaitCommand)
export class ResetConcurrencyWaitHandler implements ICommandHandler<ResetConcurrencyWaitCommand> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<ConcurrencyWaitSetting> {
    await this.store.reset('concurrencyWaitSeconds');
    return toConcurrencyWaitSetting({
      value: SETTING_DEFINITIONS.concurrencyWaitSeconds.default,
      isDefault: true,
    });
  }
}
