import { Query } from "@nestjs/cqrs";
import type { UsageSummary } from "../../models/usage.js";
import type { UsageFilter } from "../../schemas/usage.schema.js";

/** One summary of the Usage Logs matching the filters. */
export class SummarizeUsageQuery extends Query<UsageSummary> {
  constructor(readonly filter: UsageFilter) {
    super();
  }
}
