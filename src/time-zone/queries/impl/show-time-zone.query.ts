import { Query } from "@nestjs/cqrs";
import type { ServerTimeZone } from "@/time-zone/models/server-time-zone.js";

export class ShowTimeZoneQuery extends Query<ServerTimeZone> {}
