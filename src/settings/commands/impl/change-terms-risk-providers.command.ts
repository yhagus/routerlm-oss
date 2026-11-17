import { Command } from "@nestjs/cqrs";
import type { TermsRiskProvidersSetting } from "../../models/terms-risk-providers.js";

/** Allows or blocks Terms Risk Providers. Their stored isEnabled never changes. */
export class ChangeTermsRiskProvidersCommand extends Command<TermsRiskProvidersSetting> {
  constructor(readonly allowed: boolean) {
    super();
  }
}
