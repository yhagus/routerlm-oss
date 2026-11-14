import { Module } from "@nestjs/common";
import { ErrorCapturesController } from "./error-captures.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";

/**
 * The backend's side of Error Captures: the dashboard's read API. The worker
 * writes them (UsageWriter) and deletes expired ones (ErrorCaptureRetention).
 */
@Module({
  controllers: [ErrorCapturesController],
  providers: [...QueryHandlers],
})
export class ErrorCapturesModule {}
