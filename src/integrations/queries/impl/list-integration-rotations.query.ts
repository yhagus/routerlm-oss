import { Query } from "@nestjs/cqrs";
import type { IntegrationRotation } from "@/integrations/models/integration.js";

export class ListIntegrationRotationsQuery extends Query<IntegrationRotation[]> {
  constructor(readonly integrationId: string) {
    super();
  }
}
