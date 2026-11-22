import { Query } from "@nestjs/cqrs";
import type { PrivateUpstreamsSetting } from "@/settings/models/private-upstreams.js";

/** Whether private upstreams are allowed, read from the database on every call. */
export class ShowPrivateUpstreamsQuery extends Query<PrivateUpstreamsSetting> {}
