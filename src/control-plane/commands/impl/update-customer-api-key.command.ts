import { Command } from '@nestjs/cqrs';
import type { IntegrationPrincipal } from '@/integrations/models/integration';
import type { CustomerApiKey } from '@/control-plane/models/customer-api-key';
import type { CustomerApiKeyChanges } from '@/control-plane/schemas/customer-api-key.schema';

export class UpdateCustomerApiKeyCommand extends Command<CustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
    readonly changes: CustomerApiKeyChanges,
  ) {
    super();
  }
}
