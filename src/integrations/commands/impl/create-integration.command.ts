import { Command } from "@nestjs/cqrs";
import type { CreatedIntegration } from "../../models/integration.js";
import type { NewIntegration } from "../../schemas/integration.schema.js";

/** Creates an Integration and returns its Integration Secret, the only time it is shown. Only its hash is kept. */
export class CreateIntegrationCommand extends Command<CreatedIntegration> {
  constructor(
    readonly newIntegration: NewIntegration,
    readonly createdById: string,
  ) {
    super();
  }
}
