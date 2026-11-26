import { Query } from "@nestjs/cqrs";
import type { PrivateUpstreamsSetting } from "@/settings/models/private-upstreams";

export class ShowPrivateUpstreamsQuery extends Query<PrivateUpstreamsSetting> {}
