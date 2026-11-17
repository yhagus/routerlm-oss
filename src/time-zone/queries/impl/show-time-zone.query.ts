import { Query } from "@nestjs/cqrs";
import type { ServerTimeZone } from "../../models/server-time-zone.js";

/** The time zone the server runs in. */
export class ShowTimeZoneQuery extends Query<ServerTimeZone> {}
