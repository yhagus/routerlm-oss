import { ChangeErrorCaptureRetentionHandler } from "./change-error-capture-retention.handler.js";
import { ResetErrorCaptureRetentionHandler } from "./reset-error-capture-retention.handler.js";

export const CommandHandlers = [
  ChangeErrorCaptureRetentionHandler,
  ResetErrorCaptureRetentionHandler,
];
