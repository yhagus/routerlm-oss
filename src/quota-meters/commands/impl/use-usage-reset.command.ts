import { Command } from "@nestjs/cqrs";
import type { ProviderAccountQuota } from "@/quota-meters/models/quota-meter.js";

export class UseUsageResetCommand extends Command<ProviderAccountQuota> {
  constructor(
    readonly providerAccountId: string,
    readonly usageResetId: string,
    readonly idempotencyKey: string,
  ) {
    super();
  }
}
