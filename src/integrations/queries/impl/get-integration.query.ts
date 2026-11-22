import { Query } from "@nestjs/cqrs";
import type { IntegrationDetail } from "@/integrations/models/integration.js";

/** One Integration with its API Key and Customer counts. */
export class GetIntegrationQuery extends Query<IntegrationDetail> {
  constructor(readonly id: string) {
    super();
  }
}
