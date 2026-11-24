import { Query } from "@nestjs/cqrs";
import type { IntegrationCustomerPage } from "@/integrations/models/integration.js";
import type { IntegrationCustomersQuery } from "@/integrations/schemas/integration-customers-query.schema.js";

export class ListIntegrationCustomersQuery extends Query<IntegrationCustomerPage> {
  constructor(
    readonly integrationId: string,
    readonly pageQuery: IntegrationCustomersQuery,
  ) {
    super();
  }
}
