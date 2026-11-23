import { Body, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import { ReadProviderAccountQuotaCommand } from "./commands/impl/read-provider-account-quota.command.js";
import { UseUsageResetCommand } from "./commands/impl/use-usage-reset.command.js";
import type { ProviderAccountQuota } from "./models/quota-meter.js";
import { type UsageResetSpend, usageResetSpendSchema } from "./schemas/usage-reset-spend.schema.js";

@DashboardController("provider-accounts")
export class ProviderAccountQuotaController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * The dashboard's Refresh button. A failed reading still answers 200, with
   * the last meters and `quotaError` set.
   */
  @Post(":id/quota-reading")
  @HttpCode(HttpStatus.OK)
  readQuotaNow(
    @Param("id", ParseUUIDPipe) providerAccountId: string,
  ): Promise<ProviderAccountQuota> {
    return this.commandBus.execute(new ReadProviderAccountQuotaCommand(providerAccountId));
  }

  /**
   * Spends a Usage Reset, then answers the account's quota as a fresh reading
   * left it. 404 for a reset the account no longer lists; 409 when its
   * Provider has no Usage Resets or refuses this one; 502 when the Provider
   * fails, with the reason a failed reading records.
   */
  @Post(":id/usage-resets/:resetId/use")
  @HttpCode(HttpStatus.OK)
  useUsageReset(
    @Param("id", ParseUUIDPipe) providerAccountId: string,
    @Param("resetId", ParseUUIDPipe) usageResetId: string,
    @Body({ schema: usageResetSpendSchema }) { idempotencyKey }: UsageResetSpend,
  ): Promise<ProviderAccountQuota> {
    return this.commandBus.execute(
      new UseUsageResetCommand(providerAccountId, usageResetId, idempotencyKey),
    );
  }
}
