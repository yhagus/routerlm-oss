import { Query } from "@nestjs/cqrs";
import type { UsageLogDetail } from "@/usage/models/usage";

export class ShowUsageLogQuery extends Query<UsageLogDetail> {
  constructor(readonly id: string) {
    super();
  }
}
