import { Module } from "@nestjs/common";
import { ErrorCapturesController } from "./error-captures.controller.js";
import { ErrorCapturesService } from "./error-captures.service.js";

/**
 * The backend's side of Error Captures: the dashboard's read API. The worker
 * writes them (UsageWriter) and deletes expired ones (ErrorCaptureRetention).
 */
@Module({
  controllers: [ErrorCapturesController],
  providers: [ErrorCapturesService],
})
export class ErrorCapturesModule {}
