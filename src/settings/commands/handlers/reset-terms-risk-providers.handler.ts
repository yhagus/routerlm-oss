import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { SETTING_DEFINITIONS } from '@/settings/models/setting-definitions';
import { toTermsRiskProvidersSetting } from '@/settings/models/terms-risk-providers-view';
import type { TermsRiskProvidersSetting } from '@/settings/models/terms-risk-providers';
import { SettingsStore } from '@/settings/providers/settings-store';
import { ResetTermsRiskProvidersCommand } from '@/settings/commands/impl/reset-terms-risk-providers.command';

@CommandHandler(ResetTermsRiskProvidersCommand)
export class ResetTermsRiskProvidersHandler implements ICommandHandler<ResetTermsRiskProvidersCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute(): Promise<TermsRiskProvidersSetting> {
    await this.store.reset('allowTermsRiskProviders');
    await this.snapshot.changed();
    return toTermsRiskProvidersSetting({
      value: SETTING_DEFINITIONS.allowTermsRiskProviders.default,
      isDefault: true,
    });
  }
}
