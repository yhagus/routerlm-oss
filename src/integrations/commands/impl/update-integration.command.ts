import { Command } from '@nestjs/cqrs';
import type { IntegrationSummary } from '@/integrations/models/integration';
import type { IntegrationChanges } from '@/integrations/schemas/integration.schema';

export class UpdateIntegrationCommand extends Command<IntegrationSummary> {
  constructor(
    readonly id: string,
    readonly changes: IntegrationChanges,
  ) {
    super();
  }
}
