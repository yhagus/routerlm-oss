import { Query } from "@nestjs/cqrs";
import type { IntegrationRotation } from "../../models/integration.js";

/** An Integration Secret's rotations, newest first. */
export class ListIntegrationRotationsQuery extends Query<IntegrationRotation[]> {
  constructor(readonly integrationId: string) {
    super();
  }
}
