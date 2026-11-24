import { Query } from "@nestjs/cqrs";
import type { ListModelsResponseJson } from "@/control-plane/models/proto-json.js";

export class ListIntegrationOfferedModelsQuery extends Query<ListModelsResponseJson> {
  constructor(readonly integrationId: string) {
    super();
  }
}
