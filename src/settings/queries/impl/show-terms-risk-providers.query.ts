import { Query } from '@nestjs/cqrs';
import type { TermsRiskProvidersSetting } from '@/settings/models/terms-risk-providers';

export class ShowTermsRiskProvidersQuery extends Query<TermsRiskProvidersSetting> {}
