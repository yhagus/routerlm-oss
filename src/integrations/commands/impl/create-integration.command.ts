import { Command } from "@nestjs/cqrs";
import type { CreatedIntegration } from "@/integrations/models/integration.js";
import type { NewIntegration } from "@/integrations/schemas/integration.schema.js";

export class CreateIntegrationCommand extends Command<CreatedIntegration> {
  constructor(
    readonly newIntegration: NewIntegration,
    readonly createdById: string,
  ) {
    super();
  }
}
