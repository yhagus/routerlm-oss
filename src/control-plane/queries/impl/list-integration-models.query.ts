import { Query } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { IntegrationModel } from "@/control-plane/models/integration-model.js";

/** The Models the Integration may sell, by name, with their prices (ListModels). */
export class ListIntegrationModelsQuery extends Query<IntegrationModel[]> {
  constructor(readonly integration: IntegrationPrincipal) {
    super();
  }
}
