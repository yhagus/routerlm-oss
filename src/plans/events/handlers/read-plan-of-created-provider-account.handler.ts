import { Logger } from '@nestjs/common';
import { CommandBus, EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { BackgroundWork } from '@/libs/providers/background-work';
import { providers } from '@/db/schemas';
import { ProviderAccountCreatedEvent } from '@/upstream/events/impl/provider-account-created.event';
import { ReadProviderAccountPlanCommand } from '@/plans/commands/impl/read-provider-account-plan.command';
import { ReadProviderPlanCoverageCommand } from '@/plans/commands/impl/read-provider-plan-coverage.command';

@EventsHandler(ProviderAccountCreatedEvent)
export class ReadPlanOfCreatedProviderAccountHandler implements IEventHandler<ProviderAccountCreatedEvent> {
  private readonly logger = new Logger(ReadPlanOfCreatedProviderAccountHandler.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly commandBus: CommandBus,
    private readonly backgroundWork: BackgroundWork,
  ) {}

  handle({ providerAccountId, providerId }: ProviderAccountCreatedEvent): void {
    this.backgroundWork.run(this.readPlanOf(providerAccountId, providerId));
  }

  private async readPlanOf(providerAccountId: string, providerId: string): Promise<void> {
    try {
      if (!(await this.reportsPlans(providerId))) {
        return;
      }
      await this.commandBus.execute(new ReadProviderAccountPlanCommand(providerAccountId));
      await this.commandBus.execute(new ReadProviderPlanCoverageCommand(providerId));
    } catch (error) {
      this.logger.error(
        `Reading the Plan of new Provider Account ${providerAccountId} failed: ${String(error)}`,
      );
    }
  }

  private async reportsPlans(providerId: string): Promise<boolean> {
    const [provider] = await this.db
      .select({ planReader: providers.planReader })
      .from(providers)
      .where(eq(providers.id, providerId));
    return provider?.planReader != null;
  }
}
