import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { toTermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers-view";
import type { TermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers";
import { SettingsStore } from "@/settings/providers/settings-store";
import { ShowTermsRiskProvidersQuery } from "@/settings/queries/impl/show-terms-risk-providers.query";

@QueryHandler(ShowTermsRiskProvidersQuery)
export class ShowTermsRiskProvidersHandler implements IQueryHandler<ShowTermsRiskProvidersQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<TermsRiskProvidersSetting> {
    return toTermsRiskProvidersSetting(await this.store.read("allowTermsRiskProviders"));
  }
}
