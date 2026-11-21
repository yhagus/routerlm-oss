import { Command } from "@nestjs/cqrs";
import type { CreatedIntegration } from "../../models/integration.js";

/** Replaces the Integration Secret, recording the rotation; the old secret stops working at once. */
export class RotateIntegrationSecretCommand extends Command<CreatedIntegration> {
  constructor(
    readonly id: string,
    readonly rotatedById: string,
  ) {
    super();
  }
}
