import { Query } from "@nestjs/cqrs";
import type { ModelDetail } from "../../models/model.js";

/** The Model with its Routes, in the order the gateway tries them. */
export class GetModelQuery extends Query<ModelDetail> {
  constructor(readonly modelId: string) {
    super();
  }
}
