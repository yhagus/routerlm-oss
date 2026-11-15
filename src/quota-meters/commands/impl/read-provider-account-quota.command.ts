import { Command } from "@nestjs/cqrs";
import type { ProviderAccountQuota } from "../../models/quota-meter.js";

/**
 * Reads a Provider Account's Quota Meters now and stores them. A failed
 * reading keeps the last meters and records why in `quota_error`; it never
 * disables the account or puts it in Cooldown.
 */
export class ReadProviderAccountQuotaCommand extends Command<ProviderAccountQuota> {
  constructor(readonly providerAccountId: string) {
    super();
  }
}
