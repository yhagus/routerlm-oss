import { Command } from '@nestjs/cqrs';
import type { IntegrationPrincipal } from '@/integrations/models/integration';
import type { IssuedCustomerApiKey } from '@/control-plane/models/customer-api-key';

export class RotateCustomerApiKeyCommand extends Command<IssuedCustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
  ) {
    super();
  }
}
