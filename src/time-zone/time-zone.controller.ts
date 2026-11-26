import { Get } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator";
import type { ServerTimeZone } from "./models/server-time-zone";
import { ShowTimeZoneQuery } from "./queries/impl/show-time-zone.query";

@DashboardController("time-zone")
export class TimeZoneController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  showTimeZone(): Promise<ServerTimeZone> {
    return this.queryBus.execute(new ShowTimeZoneQuery());
  }
}
