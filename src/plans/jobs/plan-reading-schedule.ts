import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Job, Queue } from 'bullmq';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, providers } from '@/db/schemas';
import { PLANS_QUEUE } from '@/queue/models/queue-names';
import { ReadProviderAccountPlanCommand } from '@/plans/commands/impl/read-provider-account-plan.command';
import { ReadProviderPlanCoverageCommand } from '@/plans/commands/impl/read-provider-plan-coverage.command';

export const PLAN_READING_SCHEDULER = 'plan-reading';
const READ_PLANS_JOB = 'read-plans';

const READ_EVERY_MS = 60 * 60 * 1000;

@Injectable()
export class PlanReadingSchedule implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlanReadingSchedule.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    @InjectQueue(PLANS_QUEUE) private readonly queue: Queue,
    private readonly commandBus: CommandBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      PLAN_READING_SCHEDULER,
      { every: READ_EVERY_MS },
      { name: READ_PLANS_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async readPlansAndCoverage(): Promise<void> {
    const providerIds = await this.providerIdsWithPlanReader();
    const accountIds = await this.enabledAccountIdsWithPlanReader();
    const readings = await Promise.allSettled([
      ...providerIds.map((id) => this.commandBus.execute(new ReadProviderPlanCoverageCommand(id))),
      ...accountIds.map((id) => this.commandBus.execute(new ReadProviderAccountPlanCommand(id))),
    ]);
    for (const reading of readings) {
      if (reading.status === 'rejected') {
        this.logger.error(`A scheduled Plan reading failed: ${String(reading.reason)}`);
      }
    }
  }

  private async providerIdsWithPlanReader(): Promise<string[]> {
    const rows = await this.db
      .select({ id: providers.id })
      .from(providers)
      .where(isNotNull(providers.planReader));
    return rows.map((provider) => provider.id);
  }

  private async enabledAccountIdsWithPlanReader(): Promise<string[]> {
    const rows = await this.db
      .select({ id: providerAccounts.id })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(and(eq(providerAccounts.isEnabled, true), isNotNull(providers.planReader)));
    return rows.map((account) => account.id);
  }
}

@Processor(PLANS_QUEUE)
export class PlanReadingScheduleProcessor extends WorkerHost {
  constructor(private readonly schedule: PlanReadingSchedule) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.schedule.readPlansAndCoverage();
  }
}
