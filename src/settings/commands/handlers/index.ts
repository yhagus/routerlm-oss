import { ChangeErrorCaptureRetentionHandler } from "./change-error-capture-retention.handler.js";
import { ChangeTermsRiskProvidersHandler } from "./change-terms-risk-providers.handler.js";
import { ResetErrorCaptureRetentionHandler } from "./reset-error-capture-retention.handler.js";

import { ResetTermsRiskProvidersHandler } from "./reset-terms-risk-providers.handler.js";

export const CommandHandlers = [
  ChangeErrorCaptureRetentionHandler,
  ResetErrorCaptureRetentionHandler,
  ChangeTermsRiskProvidersHandler,
  ResetTermsRiskProvidersHandler,
];
