import { Module } from "@nestjs/common";
import { ErrorCapturesController } from "./error-captures.controller";
import { QueryHandlers } from "./queries/handlers";

@Module({
  controllers: [ErrorCapturesController],
  providers: [...QueryHandlers],
})
export class ErrorCapturesModule {}
