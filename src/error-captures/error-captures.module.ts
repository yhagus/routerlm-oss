import { Module } from "@nestjs/common";
import { ErrorCapturesController } from "./error-captures.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";

@Module({
  controllers: [ErrorCapturesController],
  providers: [...QueryHandlers],
})
export class ErrorCapturesModule {}
