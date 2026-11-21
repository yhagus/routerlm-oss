import { Command } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { IssuedCustomerApiKey } from "../../models/customer-api-key.js";
import type { NewCustomerApiKey } from "../../schemas/customer-api-key.schema.js";

/** Issues an API Key to one of the Integration's Customers (CreateKey) and returns it whole: only here and on rotation. */
export class CreateCustomerApiKeyCommand extends Command<IssuedCustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly newKey: NewCustomerApiKey,
  ) {
    super();
  }
}
