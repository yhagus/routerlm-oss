import { Command } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration";
import type { CustomerApiKey } from "@/control-plane/models/customer-api-key";

export class RevokeCustomerApiKeyCommand extends Command<CustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
  ) {
    super();
  }
}
