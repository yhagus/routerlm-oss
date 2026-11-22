import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { toTermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers-view.js";
import type { TermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers.js";
import { SettingsStore } from "@/settings/providers/settings-store.js";
import { ChangeTermsRiskProvidersCommand } from "@/settings/commands/impl/change-terms-risk-providers.command.js";

@CommandHandler(ChangeTermsRiskProvidersCommand)
export class ChangeTermsRiskProvidersHandler implements ICommandHandler<ChangeTermsRiskProvidersCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ allowed }: ChangeTermsRiskProvidersCommand): Promise<TermsRiskProvidersSetting> {
    await this.store.write("allowTermsRiskProviders", allowed);
    await this.snapshot.changed();
    return toTermsRiskProvidersSetting({ value: allowed, isDefault: false });
  }
}
