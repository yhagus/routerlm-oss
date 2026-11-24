import { Query } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { CustomerApiKeyPage } from "@/control-plane/models/customer-api-key.js";
import type { CustomerApiKeyPageQuery } from "@/control-plane/schemas/customer-api-key.schema.js";

export class ListCustomerApiKeysQuery extends Query<CustomerApiKeyPage> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly page: CustomerApiKeyPageQuery,
  ) {
    super();
  }
}
