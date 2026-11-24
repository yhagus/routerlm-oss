import { Query } from "@nestjs/cqrs";
import type { IntegrationDetail } from "@/integrations/models/integration.js";

export class GetIntegrationQuery extends Query<IntegrationDetail> {
  constructor(readonly id: string) {
    super();
  }
}
