import { Query } from "@nestjs/cqrs";
import type { ModelSummary } from "@/routing/models/model.js";

/** Every Model by name, each with how many Routes it has. */
export class ListModelsQuery extends Query<ModelSummary[]> {}
