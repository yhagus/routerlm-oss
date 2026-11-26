import { Query } from "@nestjs/cqrs";
import type { ListedUpstreamModel } from "@/upstream/models/upstream-model";

export class ListUpstreamModelsQuery extends Query<ListedUpstreamModel[]> {}
