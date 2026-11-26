import { Query } from '@nestjs/cqrs';
import type { IntegrationPrincipal } from '@/integrations/models/integration';
import type { CustomerApiKey } from '@/control-plane/models/customer-api-key';

export class GetCustomerApiKeyQuery extends Query<CustomerApiKey> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly id: string,
  ) {
    super();
  }
}
