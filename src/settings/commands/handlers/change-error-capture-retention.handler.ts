import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toErrorCaptureRetention } from '@/settings/models/error-capture-retention-view';
import type { ErrorCaptureRetention } from '@/settings/models/error-capture-retention';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ChangeErrorCaptureRetentionCommand } from '@/settings/commands/impl/change-error-capture-retention.command';

@CommandHandler(ChangeErrorCaptureRetentionCommand)
export class ChangeErrorCaptureRetentionHandler implements ICommandHandler<ChangeErrorCaptureRetentionCommand> {
  constructor(private readonly store: SettingsStore) {}

  async execute({ days }: ChangeErrorCaptureRetentionCommand): Promise<ErrorCaptureRetention> {
    await this.store.write('errorCaptureRetentionDays', days);
    return toErrorCaptureRetention({ value: days, isDefault: false });
  }
}
