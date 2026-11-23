import { Query } from "@nestjs/cqrs";
import type { UsageReset } from "@/quota-meters/models/usage-reset.js";

export type { UsageReset };

/**
 * The stored, unexpired Usage Resets of each of the Provider Accounts, by
 * account id, soonest expiry first. An account whose Provider has no Usage
 * Resets is absent; one that has none right now maps to none.
 */
export class ListUsageResetsQuery extends Query<Map<string, UsageReset[]>> {
  constructor(readonly providerAccountIds: string[]) {
    super();
  }
}
