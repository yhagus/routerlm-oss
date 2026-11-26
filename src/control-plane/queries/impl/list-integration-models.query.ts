import { Query } from '@nestjs/cqrs';
import type { IntegrationPrincipal } from '@/integrations/models/integration';
import type { IntegrationModel } from '@/control-plane/models/integration-model';

export class ListIntegrationModelsQuery extends Query<IntegrationModel[]> {
  constructor(readonly integration: IntegrationPrincipal) {
    super();
  }
}
