import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Job, Queue } from "bullmq";
import { and, eq, exists, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { providerAccounts, providers, quotaMeters } from "@/db/schemas";
import { QUOTA_METERS_QUEUE } from "@/queue/models/queue-names";
import { ReadProviderAccountQuotaCommand } from "@/quota-meters/commands/impl/read-provider-account-quota.command";

export const QUOTA_READING_SCHEDULER = "quota-reading";
const READ_DUE_ACCOUNTS_JOB = "read-due-accounts";

const MINUTE_MS = 60 * 1000;
const TICK_EVERY_MS = MINUTE_MS;
const READ_EVERY_MS = 5 * MINUTE_MS;
const READ_LOW_EVERY_MS = MINUTE_MS;
const LOW_REMAINING_PERCENT = 10;
const TICK_TOLERANCE_MS = TICK_EVERY_MS / 2;

@Injectable()
export class QuotaReadingSchedule implements OnApplicationBootstrap {
  private readonly logger = new Logger(QuotaReadingSchedule.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    @InjectQueue(QUOTA_METERS_QUEUE) private readonly queue: Queue,
    private readonly commandBus: CommandBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      QUOTA_READING_SCHEDULER,
      { every: TICK_EVERY_MS },
      { name: READ_DUE_ACCOUNTS_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async readDueProviderAccounts(): Promise<void> {
    const dueAccountIds = await this.dueProviderAccountIds(new Date());
    const readings = await Promise.allSettled(
      dueAccountIds.map((id) => this.commandBus.execute(new ReadProviderAccountQuotaCommand(id))),
    );
    for (const reading of readings) {
      if (reading.status === "rejected") {
        this.logger.error(`A scheduled quota reading failed: ${String(reading.reason)}`);
      }
    }
  }

  private async dueProviderAccountIds(now: Date): Promise<string[]> {
    const relaxedCutoff = new Date(now.getTime() - READ_EVERY_MS + TICK_TOLERANCE_MS);
    const lowCutoff = new Date(now.getTime() - READ_LOW_EVERY_MS + TICK_TOLERANCE_MS);
    const hasLowUnscopedMeter = exists(
      this.db
        .select({ id: quotaMeters.id })
        .from(quotaMeters)
        .where(
          and(
            eq(quotaMeters.providerAccountId, providerAccounts.id),
            isNull(quotaMeters.scope),
            lt(quotaMeters.remainingPercent, LOW_REMAINING_PERCENT),
          ),
        ),
    );
    const due = await this.db
      .select({ id: providerAccounts.id })
      .from(providerAccounts)
      .innerJoin(providers, eq(providers.id, providerAccounts.providerId))
      .where(
        and(
          eq(providerAccounts.isEnabled, true),
          isNotNull(providers.quotaReader),
          or(
            isNull(providerAccounts.quotaCheckedAt),
            lte(providerAccounts.quotaCheckedAt, relaxedCutoff),
            and(lte(providerAccounts.quotaCheckedAt, lowCutoff), hasLowUnscopedMeter),
          ),
        ),
      );
    return due.map((account) => account.id);
  }
}

@Processor(QUOTA_METERS_QUEUE)
export class QuotaReadingScheduleProcessor extends WorkerHost {
  constructor(private readonly schedule: QuotaReadingSchedule) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.schedule.readDueProviderAccounts();
  }
}
