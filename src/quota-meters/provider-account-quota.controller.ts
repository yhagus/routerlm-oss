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

  @Post(":id/quota-reading")
  @HttpCode(HttpStatus.OK)
  readQuotaNow(
    @Param("id", ParseUUIDPipe) providerAccountId: string,
  ): Promise<ProviderAccountQuota> {
    return this.commandBus.execute(new ReadProviderAccountQuotaCommand(providerAccountId));
  }

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
