import { Command } from "@nestjs/cqrs";
import type { ProviderAccountQuota } from "@/quota-meters/models/quota-meter.js";

/**
 * Spends one of a Provider Account's Usage Resets, whatever the account's
 * enabled or terms-risk state, then fetches its resets and reads its Quota
 * Meters again. Answers the account's quota as that reading left it.
 */
export class UseUsageResetCommand extends Command<ProviderAccountQuota> {
  constructor(
    readonly providerAccountId: string,
    /** Our id of the reset, as the dashboard lists it. */
    readonly usageResetId: string,
    /** Sent to the Provider, which spends a reset at most once per key. */
    readonly idempotencyKey: string,
  ) {
    super();
  }
}
