import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import type { ServerTimeZone } from "@/time-zone/models/server-time-zone.js";
import { ShowTimeZoneQuery } from "@/time-zone/queries/impl/show-time-zone.query.js";

@QueryHandler(ShowTimeZoneQuery)
export class ShowTimeZoneHandler implements IQueryHandler<ShowTimeZoneQuery> {
  execute(): Promise<ServerTimeZone> {
    // Read on every call: the process's zone can change while it runs (TZ).
    return Promise.resolve({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  }
}
