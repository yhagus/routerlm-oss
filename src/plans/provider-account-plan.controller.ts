import { HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import type { ProviderAccount } from '@/upstream/models/provider-account';
import { ReadProviderAccountPlanCommand } from './commands/impl/read-provider-account-plan.command';
import { ReadProviderPlanCoverageCommand } from './commands/impl/read-provider-plan-coverage.command';

@DashboardController('provider-accounts')
export class ProviderAccountPlanController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post(':id/plan')
  @HttpCode(HttpStatus.OK)
  async readPlanNow(
    @Param('id', ParseUUIDPipe) providerAccountId: string,
  ): Promise<ProviderAccount> {
    const account = await this.commandBus.execute(
      new ReadProviderAccountPlanCommand(providerAccountId),
    );
    await this.commandBus.execute(new ReadProviderPlanCoverageCommand(account.providerId));
    return account;
  }
}
