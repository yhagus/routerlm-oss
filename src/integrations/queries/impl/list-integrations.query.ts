import { Query } from "@nestjs/cqrs";
import type { IntegrationSummary } from "../../models/integration.js";

/** Every Integration, newest first. */
export class ListIntegrationsQuery extends Query<IntegrationSummary[]> {}
