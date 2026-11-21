import { Query } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { CustomerApiKeyPage } from "../../models/customer-api-key.js";
import type { CustomerApiKeyPageQuery } from "../../schemas/customer-api-key.schema.js";

/** A page of the Integration's keys, newest first, optionally one Customer's (ListKeys). */
export class ListCustomerApiKeysQuery extends Query<CustomerApiKeyPage> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly page: CustomerApiKeyPageQuery,
  ) {
    super();
  }
}
