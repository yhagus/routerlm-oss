import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { toErrorCaptureRetention } from "@/settings/models/error-capture-retention-view";
import type { ErrorCaptureRetention } from "@/settings/models/error-capture-retention";
import { SETTING_DEFINITIONS } from "@/settings/models/setting-definitions";
import { SettingsStore } from "@/settings/providers/settings-store";
import { ResetErrorCaptureRetentionCommand } from "@/settings/commands/impl/reset-error-capture-retention.command";

@CommandHandler(ResetErrorCaptureRetentionCommand)
export class ResetErrorCaptureRetentionHandler implements ICommandHandler<ResetErrorCaptureRetentionCommand> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<ErrorCaptureRetention> {
    await this.store.reset("errorCaptureRetentionDays");
    return toErrorCaptureRetention({
      value: SETTING_DEFINITIONS.errorCaptureRetentionDays.default,
      isDefault: true,
    });
  }
}
