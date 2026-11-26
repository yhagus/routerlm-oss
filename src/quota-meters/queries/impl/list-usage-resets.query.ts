import { Query } from "@nestjs/cqrs";
import type { UsageReset } from "@/quota-meters/models/usage-reset";

export type { UsageReset };

export class ListUsageResetsQuery extends Query<Map<string, UsageReset[]>> {
  constructor(readonly providerAccountIds: string[]) {
    super();
  }
}
