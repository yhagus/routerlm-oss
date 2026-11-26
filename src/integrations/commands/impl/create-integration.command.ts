import { Command } from "@nestjs/cqrs";
import type { CreatedIntegration } from "@/integrations/models/integration";
import type { NewIntegration } from "@/integrations/schemas/integration.schema";

export class CreateIntegrationCommand extends Command<CreatedIntegration> {
  constructor(
    readonly newIntegration: NewIntegration,
    readonly createdById: string,
  ) {
    super();
  }
}
