import { Command } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration";
import type { IssuedCustomerApiKey } from "@/control-plane/models/customer-api-key";
import type { NewCustomerApiKey } from "@/control-plane/schemas/customer-api-key.schema";

export class CreateCustomerApiKeyCommand extends Command<IssuedCustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly newKey: NewCustomerApiKey,
  ) {
    super();
  }
}
