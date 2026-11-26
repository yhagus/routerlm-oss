import { Query } from '@nestjs/cqrs';
import type { IntegrationPrincipal } from '@/integrations/models/integration';
import type { CustomerApiKeyPage } from '@/control-plane/models/customer-api-key';
import type { CustomerApiKeyPageQuery } from '@/control-plane/schemas/customer-api-key.schema';

export class ListCustomerApiKeysQuery extends Query<CustomerApiKeyPage> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly page: CustomerApiKeyPageQuery,
  ) {
    super();
  }
}
