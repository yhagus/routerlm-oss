import { Command } from '@nestjs/cqrs';
import type { TermsRiskProvidersSetting } from '@/settings/models/terms-risk-providers';

export class ChangeTermsRiskProvidersCommand extends Command<TermsRiskProvidersSetting> {
  constructor(readonly allowed: boolean) {
    super();
  }
}
