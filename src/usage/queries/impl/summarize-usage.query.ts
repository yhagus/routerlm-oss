import { Query } from "@nestjs/cqrs";
import type { UsageSummary } from "@/usage/models/usage.js";
import type { UsageFilter } from "@/usage/schemas/usage.schema.js";

export class SummarizeUsageQuery extends Query<UsageSummary> {
  constructor(readonly filter: UsageFilter) {
    super();
  }
}
