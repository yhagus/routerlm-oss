import { Query } from "@nestjs/cqrs";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import type { IntegrationUsageLogPage } from "@/control-plane/models/integration-usage-log.js";
import type { UsageLogPageQuery } from "@/control-plane/schemas/usage-log.schema.js";

/** The Integration's Usage Logs after a cursor, in the order they committed (ListUsageLogs). */
export class ListIntegrationUsageLogsQuery extends Query<IntegrationUsageLogPage> {
  constructor(
    readonly integration: IntegrationPrincipal,
    readonly page: UsageLogPageQuery,
  ) {
    super();
  }
}
