import { HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import { ReadProviderAccountQuotaCommand } from "./commands/impl/read-provider-account-quota.command.js";
import type { ProviderAccountQuota } from "./models/quota-meter.js";

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
}
