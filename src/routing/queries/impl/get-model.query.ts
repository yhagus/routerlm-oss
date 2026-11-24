import { Query } from "@nestjs/cqrs";
import type { ModelDetail } from "@/routing/models/model.js";

export class GetModelQuery extends Query<ModelDetail> {
  constructor(readonly modelId: string) {
    super();
  }
}
