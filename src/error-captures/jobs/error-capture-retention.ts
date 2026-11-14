import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Job, Queue } from "bullmq";
import { lt } from "drizzle-orm";
import type { Env } from "../../config/schemas/env.schema.js";
import type { Database } from "../../db/schemas/relations.js";
import { errorCaptures } from "../../db/schemas/index.js";
import { ERROR_CAPTURES_QUEUE } from "../../queue/models/queue-names.js";

/** Scheduler id: upserting it again on every boot keeps a single schedule. */
export const ERROR_CAPTURE_RETENTION_SCHEDULER = "error-capture-retention";
const DELETE_EXPIRED_CAPTURES_JOB = "delete-expired";
const RUN_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes Error Captures once they are older than the retention period
 * (spec "Records": 30 days by default, ERROR_CAPTURE_RETENTION_DAYS), as a
 * repeating job. Worker only.
 */
@Injectable()
export class ErrorCaptureRetention implements OnApplicationBootstrap {
  private readonly logger = new Logger(ErrorCaptureRetention.name);
  private readonly retentionDays: number;

  constructor(
    @InjectDrizzle() private readonly db: Database,
    @InjectQueue(ERROR_CAPTURES_QUEUE) private readonly queue: Queue,
    config: ConfigService<Env, true>,
  ) {
    this.retentionDays = config.get("ERROR_CAPTURE_RETENTION_DAYS", { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ERROR_CAPTURE_RETENTION_SCHEDULER,
      { every: RUN_EVERY_MS },
      { name: DELETE_EXPIRED_CAPTURES_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async deleteExpiredCaptures(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - this.retentionDays * DAY_MS);
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

/** Registered only in WorkerModule, like every processor. */
@Processor(ERROR_CAPTURES_QUEUE)
export class ErrorCaptureRetentionProcessor extends WorkerHost {
  constructor(private readonly retention: ErrorCaptureRetention) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.retention.deleteExpiredCaptures(new Date());
  }
}
