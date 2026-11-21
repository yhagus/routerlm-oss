import { Command } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { CustomerApiKey } from "../../models/customer-api-key.js";
import type { CustomerApiKeyChanges } from "../../schemas/customer-api-key.schema.js";

/** Changes the name, expiry, allowed Models, Spend Limit or Request Rate of one of the Integration's keys (UpdateKey). */
export class UpdateCustomerApiKeyCommand extends Command<CustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
    readonly changes: CustomerApiKeyChanges,
  ) {
    super();
  }
}
