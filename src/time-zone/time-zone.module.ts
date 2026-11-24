import { Module } from "@nestjs/common";
import { QueryHandlers } from "./queries/handlers/index.js";
import { TimeZoneController } from "./time-zone.controller.js";

@Module({
  controllers: [TimeZoneController],
  providers: [...QueryHandlers],
})
export class TimeZoneModule {}
