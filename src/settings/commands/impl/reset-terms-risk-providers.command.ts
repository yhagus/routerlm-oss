import { Command } from "@nestjs/cqrs";
import type { TermsRiskProvidersSetting } from "../../models/terms-risk-providers.js";

/** Returns the terms-risk Setting to its default, which blocks Terms Risk Providers. */
export class ResetTermsRiskProvidersCommand extends Command<TermsRiskProvidersSetting> {}
