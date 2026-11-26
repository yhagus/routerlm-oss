import { CountCapturesExpiredByHandler } from './count-captures-expired-by.handler';
import { ShowErrorCaptureRetentionHandler } from './show-error-capture-retention.handler';
import { ShowPrivateUpstreamsHandler } from './show-private-upstreams.handler';
import { ShowTermsRiskProvidersHandler } from './show-terms-risk-providers.handler';

export const QueryHandlers = [
  ShowErrorCaptureRetentionHandler,
  CountCapturesExpiredByHandler,
  ShowTermsRiskProvidersHandler,
  ShowPrivateUpstreamsHandler,
];
