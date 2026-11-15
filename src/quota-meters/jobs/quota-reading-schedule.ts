import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Job, Queue } from "bullmq";
import { and, eq, exists, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts, providers, quotaMeters } from "@/db/schemas/index.js";
import { QUOTA_METERS_QUEUE } from "@/queue/models/queue-names.js";
import { ReadProviderAccountQuotaCommand } from "../commands/impl/read-provider-account-quota.command.js";

/** Scheduler id: upserting it again on every boot keeps a single schedule. */
export const QUOTA_READING_SCHEDULER = "quota-reading";
const READ_DUE_ACCOUNTS_JOB = "read-due-accounts";

const MINUTE_MS = 60 * 1000;
/** How often the job looks for due accounts: the shortest reading interval. */
const TICK_EVERY_MS = MINUTE_MS;
const READ_EVERY_MS = 5 * MINUTE_MS;
/** While an unscoped meter is below LOW_REMAINING_PERCENT, an account is read this often. */
const READ_LOW_EVERY_MS = MINUTE_MS;
const LOW_REMAINING_PERCENT = 10;
/**
 * A reading finishes a little after the tick that started it, so an interval
 * counted exactly would miss the tick it is due on and wait for the next one.
 */
const TICK_TOLERANCE_MS = TICK_EVERY_MS / 2;

/**
 * Reads the Quota Meters of every enabled Provider Account whose Provider
 * has a quota reader: every 5 minutes, or every minute while one of its
 * unscoped meters is below 10%. Worker only.
 */
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

  async readDueProviderAccounts(now: Date): Promise<void> {
    const dueAccountIds = await this.dueProviderAccountIds(now);
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

/** Registered only in WorkerModule, like every processor. */
@Processor(QUOTA_METERS_QUEUE)
export class QuotaReadingScheduleProcessor extends WorkerHost {
  constructor(private readonly schedule: QuotaReadingSchedule) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.schedule.readDueProviderAccounts(new Date());
  }
}
