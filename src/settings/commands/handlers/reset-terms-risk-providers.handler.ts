import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { SETTING_DEFINITIONS } from "../../models/setting-definitions.js";
import { toTermsRiskProvidersSetting } from "../../models/terms-risk-providers-view.js";
import type { TermsRiskProvidersSetting } from "../../models/terms-risk-providers.js";
import { SettingsStore } from "../../providers/settings-store.js";
import { ResetTermsRiskProvidersCommand } from "../impl/reset-terms-risk-providers.command.js";

@CommandHandler(ResetTermsRiskProvidersCommand)
export class ResetTermsRiskProvidersHandler implements ICommandHandler<ResetTermsRiskProvidersCommand> {
  constructor(
    private readonly store: SettingsStore,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute(): Promise<TermsRiskProvidersSetting> {
    await this.store.reset("allowTermsRiskProviders");
    await this.snapshot.changed();
    return toTermsRiskProvidersSetting({
      value: SETTING_DEFINITIONS.allowTermsRiskProviders.default,
      isDefault: true,
    });
  }
}
