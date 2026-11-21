import { Query } from "@nestjs/cqrs";
import type { IntegrationCustomerPage } from "../../models/integration.js";
import type { IntegrationCustomersQuery } from "../../schemas/integration-customers-query.schema.js";

/** One page of the Customers named on an Integration's API Keys, most recently active first. */
export class ListIntegrationCustomersQuery extends Query<IntegrationCustomerPage> {
  constructor(
    readonly integrationId: string,
    readonly pageQuery: IntegrationCustomersQuery,
  ) {
    super();
  }
}
