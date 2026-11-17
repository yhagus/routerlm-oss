import { CountCapturesExpiredByHandler } from "./count-captures-expired-by.handler.js";
import { ShowErrorCaptureRetentionHandler } from "./show-error-capture-retention.handler.js";
import { ShowTermsRiskProvidersHandler } from "./show-terms-risk-providers.handler.js";

export const QueryHandlers = [
  ShowErrorCaptureRetentionHandler,
  CountCapturesExpiredByHandler,
  ShowTermsRiskProvidersHandler,
];
