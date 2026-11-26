import { Query } from '@nestjs/cqrs';
import type { IntegrationSummary } from '@/integrations/models/integration';

export class ListIntegrationsQuery extends Query<IntegrationSummary[]> {}
