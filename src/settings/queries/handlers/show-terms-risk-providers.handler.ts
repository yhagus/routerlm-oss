import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { toTermsRiskProvidersSetting } from "../../models/terms-risk-providers-view.js";
import type { TermsRiskProvidersSetting } from "../../models/terms-risk-providers.js";
import { SettingsStore } from "../../providers/settings-store.js";
import { ShowTermsRiskProvidersQuery } from "../impl/show-terms-risk-providers.query.js";

@QueryHandler(ShowTermsRiskProvidersQuery)
export class ShowTermsRiskProvidersHandler implements IQueryHandler<ShowTermsRiskProvidersQuery> {
  constructor(private readonly store: SettingsStore) {}

  async execute(): Promise<TermsRiskProvidersSetting> {
    return toTermsRiskProvidersSetting(await this.store.read("allowTermsRiskProviders"));
  }
}
