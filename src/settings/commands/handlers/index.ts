import { ChangeConcurrencyWaitHandler } from './change-concurrency-wait.handler';
import { ChangeErrorCaptureRetentionHandler } from './change-error-capture-retention.handler';
import { ChangePrivateUpstreamsHandler } from './change-private-upstreams.handler';
import { ChangeTermsRiskProvidersHandler } from './change-terms-risk-providers.handler';
import { ResetConcurrencyWaitHandler } from './reset-concurrency-wait.handler';
import { ResetErrorCaptureRetentionHandler } from './reset-error-capture-retention.handler';
import { ResetPrivateUpstreamsHandler } from './reset-private-upstreams.handler';
import { ResetTermsRiskProvidersHandler } from './reset-terms-risk-providers.handler';

export const CommandHandlers = [
  ChangeErrorCaptureRetentionHandler,
  ResetErrorCaptureRetentionHandler,
  ChangeTermsRiskProvidersHandler,
  ResetTermsRiskProvidersHandler,
  ChangePrivateUpstreamsHandler,
  ResetPrivateUpstreamsHandler,
  ChangeConcurrencyWaitHandler,
  ResetConcurrencyWaitHandler,
];
