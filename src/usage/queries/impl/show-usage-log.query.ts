import { Query } from "@nestjs/cqrs";
import type { UsageLogDetail } from "@/usage/models/usage.js";

/** One Usage Log with its Attempts. */
export class ShowUsageLogQuery extends Query<UsageLogDetail> {
  constructor(readonly id: string) {
    super();
  }
}
