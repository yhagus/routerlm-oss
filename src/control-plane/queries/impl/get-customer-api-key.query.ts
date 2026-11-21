import { Query } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { CustomerApiKey } from "../../models/customer-api-key.js";

/** One of the Integration's keys, with what it has spent (GetKey). */
export class GetCustomerApiKeyQuery extends Query<CustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
  ) {
    super();
  }
}
