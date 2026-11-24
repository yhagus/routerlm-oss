import { Command } from "@nestjs/cqrs";
import type { CreatedIntegration } from "@/integrations/models/integration.js";

export class RotateIntegrationSecretCommand extends Command<CreatedIntegration> {
  constructor(
    readonly id: string,
    readonly rotatedById: string,
  ) {
    super();
  }
}
