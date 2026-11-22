import { Command } from "@nestjs/cqrs";
import type { IntegrationSummary } from "@/integrations/models/integration.js";
import type { IntegrationChanges } from "@/integrations/schemas/integration.schema.js";

/** Renames an Integration or changes the Models its API Keys may use. */
export class UpdateIntegrationCommand extends Command<IntegrationSummary> {
  constructor(
    readonly id: string,
    readonly changes: IntegrationChanges,
  ) {
    super();
  }
}
