import { Query } from "@nestjs/cqrs";
import type { IntegrationSummary } from "@/integrations/models/integration.js";

export class ListIntegrationsQuery extends Query<IntegrationSummary[]> {}
