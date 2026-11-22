import { Query } from "@nestjs/cqrs";
import type { UpstreamModel } from "@/upstream/models/upstream-model.js";

/** Every Upstream Model, by Provider and then by upstream name. */
export class ListUpstreamModelsQuery extends Query<UpstreamModel[]> {}
