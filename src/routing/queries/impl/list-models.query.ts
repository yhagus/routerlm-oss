import { Query } from "@nestjs/cqrs";
import type { ModelSummary } from "@/routing/models/model.js";

export class ListModelsQuery extends Query<ModelSummary[]> {}
