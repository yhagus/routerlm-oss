import { Command } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { IssuedCustomerApiKey } from "@/control-plane/models/customer-api-key.js";

export class RotateCustomerApiKeyCommand extends Command<IssuedCustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
  ) {
    super();
  }
}
