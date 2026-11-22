import { Query } from "@nestjs/cqrs";
import type { TermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers.js";

/** Whether Terms Risk Providers are allowed, read from the database on every call. */
export class ShowTermsRiskProvidersQuery extends Query<TermsRiskProvidersSetting> {}
