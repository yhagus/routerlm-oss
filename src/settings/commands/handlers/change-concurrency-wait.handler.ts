import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toConcurrencyWaitSetting } from '@/settings/models/concurrency-wait-view';
import type { ConcurrencyWaitSetting } from '@/settings/models/concurrency-wait';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ChangeConcurrencyWaitCommand } from '@/settings/commands/impl/change-concurrency-wait.command';

@CommandHandler(ChangeConcurrencyWaitCommand)
export class ChangeConcurrencyWaitHandler implements ICommandHandler<ChangeConcurrencyWaitCommand> {
  constructor(private readonly store: SettingsStore) {}

  async execute({ seconds }: ChangeConcurrencyWaitCommand): Promise<ConcurrencyWaitSetting> {
    await this.store.write('concurrencyWaitSeconds', seconds);
    return toConcurrencyWaitSetting({ value: seconds, isDefault: false });
  }
}
