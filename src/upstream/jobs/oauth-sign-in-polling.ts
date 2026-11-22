import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { Job, Queue } from "bullmq";
import { OAUTH_SIGN_INS_QUEUE } from "@/queue/models/queue-names.js";
import { signInNeedsRedis } from "@/upstream/models/oauth-sign-in.js";
import { PollOauthSignInCommand } from "@/upstream/commands/impl/poll-oauth-sign-in.command.js";

const POLL_JOB = "poll";
/**
 * A poll that fails is run again, shortly: no later poll is queued behind
 * it, so giving up on it would leave the sign-in pending until its code
 * expires. Running a poll twice is safe (see PollOauthSignInHandler).
 */
const POLL_ATTEMPTS = 3;
const POLL_RETRY_BACKOFF = { type: "exponential", delay: 1000 } as const;

type PollJob = Job<{ signInId: string }>;

/**
 * Polls for pending sign-ins with one delayed job per poll, so the wait
 * between polls is held by the queue and not by a process: the backend
 * enqueues the first poll, the worker runs each one and enqueues the next,
 * and a restart of either loses nothing.
 */
@Injectable()
export class OauthSignInPolling {
  constructor(@InjectQueue(OAUTH_SIGN_INS_QUEUE) private readonly queue: Queue) {}

  /** Has the worker poll for the sign-in once, `delayMs` from now. Throws ServiceUnavailableException without Redis. */
  async pollIn(signInId: string, delayMs: number): Promise<void> {
    try {
      await this.queue.add(
        POLL_JOB,
        { signInId },
        {
          delay: delayMs,
          attempts: POLL_ATTEMPTS,
          backoff: POLL_RETRY_BACKOFF,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      throw signInNeedsRedis(error);
    }
  }
}

/** Registered only in WorkerModule, like every processor. */
@Processor(OAUTH_SIGN_INS_QUEUE)
export class OauthSignInPollingProcessor extends WorkerHost {
  constructor(private readonly commandBus: CommandBus) {
    super();
  }

  async process(job: PollJob): Promise<void> {
    await this.commandBus.execute(new PollOauthSignInCommand(job.data.signInId));
  }
}
