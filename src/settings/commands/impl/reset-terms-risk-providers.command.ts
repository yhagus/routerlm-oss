import { Command } from "@nestjs/cqrs";
import type { TermsRiskProvidersSetting } from "@/settings/models/terms-risk-providers.js";

export class ResetTermsRiskProvidersCommand extends Command<TermsRiskProvidersSetting> {}
