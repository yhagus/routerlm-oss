import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ReloadSnapshotCommand } from '@/snapshot/commands/impl/reload-snapshot.command';
import { toTermsRiskProvidersSetting } from '@/settings/models/terms-risk-providers-view';
import type { TermsRiskProvidersSetting } from '@/settings/models/terms-risk-providers';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ChangeTermsRiskProvidersCommand } from '@/settings/commands/impl/change-terms-risk-providers.command';

@CommandHandler(ChangeTermsRiskProvidersCommand)
export class ChangeTermsRiskProvidersHandler implements ICommandHandler<ChangeTermsRiskProvidersCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly commandBus: CommandBus,
  ) {}

  async execute({ allowed }: ChangeTermsRiskProvidersCommand): Promise<TermsRiskProvidersSetting> {
    await this.store.write('allowTermsRiskProviders', allowed);
    await this.commandBus.execute(new ReloadSnapshotCommand());
    return toTermsRiskProvidersSetting({ value: allowed, isDefault: false });
  }
}
