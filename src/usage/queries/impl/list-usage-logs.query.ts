import { Query } from "@nestjs/cqrs";
import type { UsageLogPage } from "../../models/usage.js";
import type { UsagePageQuery } from "../../schemas/usage.schema.js";

/** One page of Usage Logs matching the filters, newest first. */
export class ListUsageLogsQuery extends Query<UsageLogPage> {
  constructor(readonly pageQuery: UsagePageQuery) {
    super();
  }
}
