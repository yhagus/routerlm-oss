import { Module } from "@nestjs/common";
import { QueryHandlers } from "./queries/handlers";
import { TimeZoneController } from "./time-zone.controller";

@Module({
  controllers: [TimeZoneController],
  providers: [...QueryHandlers],
})
export class TimeZoneModule {}
