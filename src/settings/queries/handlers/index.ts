import { CountCapturesExpiredByHandler } from "./count-captures-expired-by.handler.js";
import { ShowErrorCaptureRetentionHandler } from "./show-error-capture-retention.handler.js";

export const QueryHandlers = [ShowErrorCaptureRetentionHandler, CountCapturesExpiredByHandler];
