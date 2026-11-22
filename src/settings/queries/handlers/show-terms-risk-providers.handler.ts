import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { toTermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers-view.js";
import type { TermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers.js";
import { SettingsStore } from "@/settings/providers/settings-store.js";
import { ShowTermsRiskProvidersQuery } from "@/settings/queries/impl/show-terms-risk-providers.query.js";

@QueryHandler(ShowTermsRiskProvidersQuery)
export class ShowTermsRiskProvidersHandler implements IQueryHandler<ShowTermsRiskProvidersQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<TermsRiskProvidersSetting> {
    return toTermsRiskProvidersSetting(await this.store.read("allowTermsRiskProviders"));
  }
}
