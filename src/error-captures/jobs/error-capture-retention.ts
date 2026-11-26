import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Job, Queue } from "bullmq";
import { lt } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations";
import { errorCaptures } from "@/db/schemas";
import { ERROR_CAPTURES_QUEUE } from "@/queue/models/queue-names";
import { ShowErrorCaptureRetentionQuery } from "@/settings/queries/impl/show-error-capture-retention.query";
import { retentionCutoff } from "@/error-captures/models/retention-cutoff";

export const ERROR_CAPTURE_RETENTION_SCHEDULER = "error-capture-retention";
const DELETE_EXPIRED_CAPTURES_JOB = "delete-expired";
const RUN_EVERY_MS = 60 * 60 * 1000;

@Injectable()
export class ErrorCaptureRetention implements OnApplicationBootstrap {
  private readonly logger = new Logger(ErrorCaptureRetention.name);

  constructor(
    @InjectDrizzle() private readonly db: Database,
    @InjectQueue(ERROR_CAPTURES_QUEUE) private readonly queue: Queue,
    private readonly queryBus: QueryBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ERROR_CAPTURE_RETENTION_SCHEDULER,
      { every: RUN_EVERY_MS },
      { name: DELETE_EXPIRED_CAPTURES_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async deleteExpiredCaptures(now: Date): Promise<void> {
    const { days } = await this.queryBus.execute(new ShowErrorCaptureRetentionQuery());
    const cutoff = retentionCutoff(now, days);
    const deleted = await this.db
      .delete(errorCaptures)
      .where(lt(errorCaptures.createdAt, cutoff))
      .returning({ id: errorCaptures.id });
    if (deleted.length > 0) {
      this.logger.log(
        `Deleted ${deleted.length} Error Captures older than ${cutoff.toISOString()}`,
      );
    }
  }
}

@Processor(ERROR_CAPTURES_QUEUE)
export class ErrorCaptureRetentionProcessor extends WorkerHost {
  constructor(private readonly retention: ErrorCaptureRetention) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.retention.deleteExpiredCaptures(new Date());
  }
}
