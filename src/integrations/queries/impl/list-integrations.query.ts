import { Query } from "@nestjs/cqrs";
import type { IntegrationSummary } from "@/integrations/models/integration.js";

/** Every Integration, newest first. */
export class ListIntegrationsQuery extends Query<IntegrationSummary[]> {}
