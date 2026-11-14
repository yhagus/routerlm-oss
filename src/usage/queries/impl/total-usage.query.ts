import { Query } from "@nestjs/cqrs";
import type { UsageTotals } from "../../models/usage.js";
import type { UsageFilter } from "../../schemas/usage.schema.js";

/** Totals by Model and by API Key over the Usage Logs matching the filters. */
export class TotalUsageQuery extends Query<UsageTotals> {
  constructor(readonly filter: UsageFilter) {
    super();
  }
}
