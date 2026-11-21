import { Query } from "@nestjs/cqrs";
import type { ListModelsResponseJson } from "@/control-plane/models/proto-json.js";

/** The Models an Integration may sell, exactly as its control plane's ListModels answers it. */
export class ListIntegrationOfferedModelsQuery extends Query<ListModelsResponseJson> {
  constructor(readonly integrationId: string) {
    super();
  }
}
